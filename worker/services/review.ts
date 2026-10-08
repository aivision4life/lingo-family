// Default decks, card creation and queue data for /api/review.
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { State } from "ts-fsrs";
import { LEARN_LANGS, type LearnLang } from "../../shared/enums";
import type { CardDto, QueueItem } from "../../shared/review";
import { buildQueue, emptyCardFields, type QueueCandidate } from "../../shared/scheduling";
import { cards, phrases, profile_decks, profiles, review_logs, words } from "../../db/schema";
import type { getDb } from "../env";

type Db = ReturnType<typeof getDb>;

/** One default deck per language (SPEC F4, M1.4). */
export const defaultDeckId = (lang: LearnLang) => `default-${lang}`;

/**
 * Supported learning languages from a stored `study_langs` value. Anything else (e.g. a
 * leftover "zh" from before M1.6) is ignored, so no deck is ever created for it.
 */
export const supportedStudyLangs = (stored: readonly unknown[]): LearnLang[] =>
  LEARN_LANGS.filter((lang) => stored.includes(lang));

// SQL list of supported languages, e.g. ('ko','en'): words in other languages get no deck or cards.
const SUPPORTED_LANGS_SQL = `(${LEARN_LANGS.map((l) => `'${l}'`).join(",")})`;

/** Values bound by both card-creation statements (?1 = profile id, ?2..?11 = empty ts-fsrs card). */
const CARD_VALUES = `?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11`;
const CARD_TYPES_SQL = `(SELECT 'recognition' AS card_type UNION ALL SELECT 'listening')`;

/**
 * Idempotent: creates the default decks, puts every word in the deck of its language,
 * links the profile to the decks of its study_langs and creates missing cards
 * (recognition + listening) for words and — except for kid profiles — their phrases.
 * Unlinked decks keep their cards, so progress is never lost.
 *
 * Uses the D1 API directly: drizzle's batch() cannot run raw SQL with parameters.
 */
export async function syncProfileCards(db: Db, d1: D1Database, profileId: string, now: Date) {
  const profile = await db.select().from(profiles).where(eq(profiles.id, profileId)).get();
  if (!profile) return null;

  const nowMs = now.getTime();
  const empty = emptyCardFields(now);
  const studied = supportedStudyLangs(profile.study_langs).map(defaultDeckId);
  const notStudied = LEARN_LANGS.map(defaultDeckId).filter((id) => !studied.includes(id));
  const bindCard = (stmt: D1PreparedStatement) =>
    stmt.bind(
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
    );

  await d1.batch([
    ...LEARN_LANGS.map((lang) =>
      d1
        .prepare("INSERT OR IGNORE INTO decks (id, name, lang, is_kid_deck, created_at) VALUES (?, ?, ?, 0, ?)")
        .bind(defaultDeckId(lang), defaultDeckId(lang), lang, nowMs),
    ),
    d1.prepare(
      `INSERT OR IGNORE INTO deck_words (deck_id, word_id)
       SELECT 'default-' || lang, id FROM words WHERE lang IN ${SUPPORTED_LANGS_SQL}`,
    ),
    ...notStudied.map((deckId) =>
      d1.prepare("DELETE FROM profile_decks WHERE profile_id = ? AND deck_id = ?").bind(profileId, deckId),
    ),
    ...studied.map((deckId) =>
      d1.prepare("INSERT OR IGNORE INTO profile_decks (profile_id, deck_id) VALUES (?, ?)").bind(profileId, deckId),
    ),
    // Word cards. Empty ts-fsrs values come from createEmptyCard(); the partial unique index
    // (profile, word, type WHERE phrase_id IS NULL) prevents duplicates. Ids: 128 random bits as hex.
    bindCard(
      d1.prepare(
        `INSERT OR IGNORE INTO cards (id, profile_id, word_id, card_type, due, stability, difficulty,
           elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, updated_at)
         SELECT lower(hex(randomblob(16))), ?1, dw.word_id, t.card_type, ${CARD_VALUES}
         FROM profile_decks pd
         JOIN deck_words dw ON dw.deck_id = pd.deck_id
         CROSS JOIN ${CARD_TYPES_SQL} t
         WHERE pd.profile_id = ?1`,
      ),
    ),
    // Phrase cards follow the deck of their root word (word_id = root, checked by a trigger).
    // Kid profiles get no phrase cards (SPEC M1.7).
    ...(profile.is_kid
      ? []
      : [
          bindCard(
            d1.prepare(
              `INSERT OR IGNORE INTO cards (id, profile_id, word_id, phrase_id, card_type, due, stability, difficulty,
                 elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, updated_at)
               SELECT lower(hex(randomblob(16))), ?1, p.word_id, p.id, t.card_type, ${CARD_VALUES}
               FROM profile_decks pd
               JOIN deck_words dw ON dw.deck_id = pd.deck_id
               JOIN phrases p ON p.word_id = dw.word_id
               CROSS JOIN ${CARD_TYPES_SQL} t
               WHERE pd.profile_id = ?1`,
            ),
          ),
        ]),
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

/** Cards of a profile in one studied language, with their word and (for phrase cards) phrase. */
async function loadCandidates(db: Db, profileId: string, lang: LearnLang, includePhrases: boolean) {
  return db
    .select({ card: cards, word: words, phrase: phrases })
    .from(cards)
    .innerJoin(words, eq(words.id, cards.word_id))
    .leftJoin(phrases, eq(phrases.id, cards.phrase_id))
    .innerJoin(profile_decks, and(eq(profile_decks.profile_id, profileId), eq(profile_decks.deck_id, defaultDeckId(lang))))
    .where(and(eq(cards.profile_id, profileId), eq(words.lang, lang), includePhrases ? undefined : isNull(cards.phrase_id)));
}

/** New recognition cards of `lang` first reviewed since `dayStart` (counts toward the daily limit). */
async function introducedSince(db: Db, profileId: string, lang: LearnLang, dayStart: Date) {
  const [row] = await db
    .select({ n: count() })
    .from(review_logs)
    .innerJoin(cards, eq(cards.id, review_logs.card_id))
    .where(
      and(
        eq(review_logs.profile_id, profileId),
        eq(review_logs.lang, lang),
        eq(review_logs.state, State.New),
        eq(cards.card_type, "recognition"),
        gte(review_logs.reviewed_at, dayStart),
      ),
    );
  return row?.n ?? 0;
}

type QueueArgs = { profileId: string; lang: LearnLang; newLimit: number; now: Date; dayStart: Date; isKid: boolean };

type CandidateRow = Awaited<ReturnType<typeof loadCandidates>>[number];

/** Key of the study item a card belongs to (its phrase, else its word). */
const itemKey = (c: typeof cards.$inferSelect) => c.phrase_id ?? `word:${c.word_id}`;

const toQueueItem = ({ card, word, phrase }: CandidateRow): QueueItem => ({
  card: toCardDto(card),
  word: phrase
    ? {
        kind: "phrase",
        id: phrase.id,
        word_id: word.id,
        root_term: word.term,
        lang: phrase.lang,
        term: phrase.text,
        reading: phrase.reading,
        gloss_vi: phrase.gloss_vi,
        gloss_en: phrase.gloss_en,
        gloss_ko: phrase.gloss_ko,
        emoji: phrase.emoji ?? word.emoji,
        hanja: null,
        han_viet: null,
        audio_key: phrase.audio_key,
        image_key: phrase.image_key,
        image_status: phrase.image_status,
      }
    : {
        kind: "word",
        id: word.id,
        word_id: word.id,
        root_term: null,
        lang: word.lang,
        term: word.term,
        reading: word.reading,
        gloss_vi: word.gloss_vi,
        gloss_en: word.gloss_en,
        gloss_ko: word.gloss_ko,
        emoji: word.emoji,
        hanja: word.hanja,
        han_viet: word.han_viet,
        audio_key: word.audio_key,
        image_key: word.image_key,
        image_status: word.image_status,
      },
});

export async function todaysQueue(db: Db, a: QueueArgs) {
  // Kid profiles never see phrase cards (even ones created before they became a kid profile).
  const rows = await loadCandidates(db, a.profileId, a.lang, !a.isKid);
  const introducedToday = await introducedSince(db, a.profileId, a.lang, a.dayStart);

  // Listening unlocks after the recognition card of the same item (word or phrase).
  const recognitionState = new Map(
    rows.filter((r) => r.card.card_type === "recognition").map((r) => [itemKey(r.card), r.card.state]),
  );
  const candidates: QueueCandidate[] = rows.map((r) => ({
    id: r.card.id,
    card_type: r.card.card_type,
    state: r.card.state,
    due: r.card.due.getTime(),
    word_created_at: (r.phrase?.created_at ?? r.word.created_at).getTime(),
    recognition_state: recognitionState.get(itemKey(r.card)) ?? null,
  }));
  const queue = buildQueue(candidates, { now: a.now, dayStart: a.dayStart, newLimit: a.newLimit, introducedToday });

  const byId = new Map(rows.map((r) => [r.card.id, r]));
  const items = queue.ids.map((id) => toQueueItem(byId.get(id)!));
  return { items, due: queue.due.length, new: queue.newCards.length };
}
