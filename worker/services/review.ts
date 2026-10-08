// Default decks, card creation and queue data for /api/review.
import { and, count, eq, gte } from "drizzle-orm";
import { State } from "ts-fsrs";
import { LEARN_LANGS, type LearnLang } from "../../shared/enums";
import type { CardDto, QueueItem } from "../../shared/review";
import { buildQueue, emptyCardFields, type QueueCandidate } from "../../shared/scheduling";
import { cards, profile_decks, profiles, review_logs, words } from "../../db/schema";
import type { getDb } from "../env";

type Db = ReturnType<typeof getDb>;

/** One default deck per language (SPEC F4, M1.4). */
export const defaultDeckId = (lang: LearnLang) => `default-${lang}`;

/**
 * Idempotent: creates the default decks, puts every word in the deck of its language,
 * links the profile to the decks of its study_langs and creates missing cards
 * (recognition + listening). Unlinked decks keep their cards, so progress is never lost.
 *
 * Uses the D1 API directly: drizzle's batch() cannot run raw SQL with parameters.
 */
export async function syncProfileCards(db: Db, d1: D1Database, profileId: string, now: Date) {
  const profile = await db.select().from(profiles).where(eq(profiles.id, profileId)).get();
  if (!profile) return null;

  const nowMs = now.getTime();
  const empty = emptyCardFields(now);
  const studied = profile.study_langs.map(defaultDeckId);
  const notStudied = LEARN_LANGS.map(defaultDeckId).filter((id) => !studied.includes(id));

  await d1.batch([
    ...LEARN_LANGS.map((lang) =>
      d1
        .prepare("INSERT OR IGNORE INTO decks (id, name, lang, is_kid_deck, created_at) VALUES (?, ?, ?, 0, ?)")
        .bind(defaultDeckId(lang), defaultDeckId(lang), lang, nowMs),
    ),
    d1.prepare("INSERT OR IGNORE INTO deck_words (deck_id, word_id) SELECT 'default-' || lang, id FROM words"),
    ...notStudied.map((deckId) =>
      d1.prepare("DELETE FROM profile_decks WHERE profile_id = ? AND deck_id = ?").bind(profileId, deckId),
    ),
    ...studied.map((deckId) =>
      d1.prepare("INSERT OR IGNORE INTO profile_decks (profile_id, deck_id) VALUES (?, ?)").bind(profileId, deckId),
    ),
    // Empty ts-fsrs values come from createEmptyCard(); UNIQUE(profile, word, type) prevents duplicates.
    // Card ids are 128 random bits as hex (generated in SQL so this stays one statement).
    d1
      .prepare(
        `INSERT OR IGNORE INTO cards (id, profile_id, word_id, card_type, due, stability, difficulty,
           elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, updated_at)
         SELECT lower(hex(randomblob(16))), ?1, dw.word_id, t.card_type, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11
         FROM profile_decks pd
         JOIN deck_words dw ON dw.deck_id = pd.deck_id
         CROSS JOIN (SELECT 'recognition' AS card_type UNION ALL SELECT 'listening') t
         WHERE pd.profile_id = ?1`,
      )
      .bind(
        profileId,
        empty.due.getTime(),
        empty.stability,
        empty.difficulty,
        empty.elapsed_days,
        empty.scheduled_days,
        empty.learning_steps,
        empty.reps,
        empty.lapses,
        empty.state,
        nowMs,
      ),
  ]);
  return profile;
}

export const toCardDto = (c: typeof cards.$inferSelect): CardDto => ({
  id: c.id,
  card_type: c.card_type,
  due: c.due.getTime(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  last_review: c.last_review?.getTime() ?? null,
});

/** All cards of a profile in one studied language, with their word and sibling state. */
async function loadCandidates(db: Db, profileId: string, lang: LearnLang) {
  const recognition = db
    .select({ word_id: cards.word_id, state: cards.state })
    .from(cards)
    .where(and(eq(cards.profile_id, profileId), eq(cards.card_type, "recognition")))
    .as("recognition");

  return db
    .select({ card: cards, word: words, recognition_state: recognition.state })
    .from(cards)
    .innerJoin(words, eq(words.id, cards.word_id))
    .innerJoin(profile_decks, and(eq(profile_decks.profile_id, profileId), eq(profile_decks.deck_id, defaultDeckId(lang))))
    .leftJoin(recognition, eq(recognition.word_id, cards.word_id))
    .where(and(eq(cards.profile_id, profileId), eq(words.lang, lang)));
}

/** New recognition cards of `lang` first reviewed since `dayStart` (counts toward the daily limit). */
async function introducedSince(db: Db, profileId: string, lang: LearnLang, dayStart: Date) {
  const [row] = await db
    .select({ n: count() })
    .from(review_logs)
    .innerJoin(cards, eq(cards.id, review_logs.card_id))
    .innerJoin(words, eq(words.id, cards.word_id))
    .where(
      and(
        eq(review_logs.profile_id, profileId),
        eq(review_logs.state, State.New),
        eq(cards.card_type, "recognition"),
        eq(words.lang, lang),
        gte(review_logs.reviewed_at, dayStart),
      ),
    );
  return row?.n ?? 0;
}

type QueueArgs = { profileId: string; lang: LearnLang; newLimit: number; now: Date; dayStart: Date };

export async function todaysQueue(db: Db, a: QueueArgs) {
  const rows = await loadCandidates(db, a.profileId, a.lang);
  const introducedToday = await introducedSince(db, a.profileId, a.lang, a.dayStart);
  const candidates: QueueCandidate[] = rows.map((r) => ({
    id: r.card.id,
    card_type: r.card.card_type,
    state: r.card.state,
    due: r.card.due.getTime(),
    word_created_at: r.word.created_at.getTime(),
    recognition_state: r.recognition_state,
  }));
  const queue = buildQueue(candidates, { now: a.now, dayStart: a.dayStart, newLimit: a.newLimit, introducedToday });

  const byId = new Map(rows.map((r) => [r.card.id, r]));
  const items: QueueItem[] = queue.ids.map((id) => {
    const { card, word } = byId.get(id)!;
    return {
      card: toCardDto(card),
      word: {
        id: word.id,
        lang: word.lang,
        term: word.term,
        reading: word.reading,
        gloss_vi: word.gloss_vi,
        gloss_en: word.gloss_en,
        gloss_ko: word.gloss_ko,
        emoji: word.emoji,
        hanzi_traditional: word.hanzi_traditional,
        han_viet: word.han_viet,
        audio_key: word.audio_key,
      },
    };
  });
  return { items, due: queue.due.length, new: queue.newCards.length };
}
