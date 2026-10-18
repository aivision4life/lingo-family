// Default decks, card creation and queue data for /api/review.
import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { State } from "ts-fsrs";
import { LEARN_LANGS, type CardType, type LearnLang } from "../../shared/enums";
import type { CardDto, QueueItem, TypeCounts } from "../../shared/review";
import { buildQueue, emptyCardFields, enabledChain, type QueueCandidate } from "../../shared/scheduling";
import { cards, examples, phrases, profile_decks, profiles, review_logs, words } from "../../db/schema";
import type { getDb } from "../env";
import { toExample } from "./phrases";

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
/** Item (alias `w`) with a drawn or uploaded image. */
const READY_IMAGE_SQL = `w.image_status = 'ready' AND w.image_key IS NOT NULL`;
const CARD_TYPES_SQL = `(SELECT 'recognition' AS card_type UNION ALL SELECT 'listening')`;

/**
 * Idempotent: creates the default decks, puts every word in the deck of its language,
 * links the profile to the decks of its study_langs and creates missing cards
 * (recognition + listening) for words and — except for kid profiles — their phrases.
 * Picture cards are created only for items whose image is ready (SPEC F4, M1.9); an item that
 * gets its image later gets its picture card then, and its existing cards keep their progress.
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
    // Picture cards of words: only when the word's image is ready.
    bindCard(
      d1.prepare(
        `INSERT OR IGNORE INTO cards (id, profile_id, word_id, card_type, due, stability, difficulty,
           elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, updated_at)
         SELECT lower(hex(randomblob(16))), ?1, dw.word_id, 'picture', ${CARD_VALUES}
         FROM profile_decks pd
         JOIN deck_words dw ON dw.deck_id = pd.deck_id
         JOIN words w ON w.id = dw.word_id
         WHERE pd.profile_id = ?1 AND ${READY_IMAGE_SQL}`,
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
          bindCard(
            d1.prepare(
              `INSERT OR IGNORE INTO cards (id, profile_id, word_id, phrase_id, card_type, due, stability, difficulty,
                 elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, updated_at)
               SELECT lower(hex(randomblob(16))), ?1, p.word_id, p.id, 'picture', ${CARD_VALUES}
               FROM profile_decks pd
               JOIN deck_words dw ON dw.deck_id = pd.deck_id
               JOIN phrases p ON p.word_id = dw.word_id
               WHERE pd.profile_id = ?1 AND ${READY_IMAGE_SQL.replaceAll("w.", "p.")}`,
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

type QueueArgs = {
  profileId: string;
  lang: LearnLang;
  newLimit: number;
  now: Date;
  dayStart: Date;
  isKid: boolean;
  /** Profile setting `card_types` (M6.6): which review card types take part. */
  cardTypes: CardType[];
};

type CandidateRow = Awaited<ReturnType<typeof loadCandidates>>[number];

/** Key of the study item a card belongs to (its phrase, else its word). */
const itemKey = (c: typeof cards.$inferSelect) => c.phrase_id ?? `word:${c.word_id}`;

const toQueueItem = (
  { card, word, phrase }: CandidateRow,
  exampleMap: Map<string, ReturnType<typeof toExample>[]>,
): QueueItem => ({
  card: toCardDto(card),
  examples: exampleMap.get(itemKey(card)) ?? [],
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

/** Examples of the studied language, grouped by the item they belong to (phrase id, else `word:<id>`). */
async function loadExamples(db: Db, lang: LearnLang) {
  const rows = await db
    .select({ ex: examples })
    .from(examples)
    .innerJoin(words, eq(words.id, examples.word_id))
    .where(eq(words.lang, lang))
    .orderBy(sql`examples.rowid`);
  const byItem = new Map<string, ReturnType<typeof toExample>[]>();
  for (const { ex } of rows) {
    const key = ex.phrase_id ?? `word:${ex.word_id}`;
    byItem.set(key, [...(byItem.get(key) ?? []), toExample(ex)]);
  }
  return byItem;
}

/** What the queue is built from: the profile's cards of one language and today's new-card count. */
export type QueueInputs = { rows: CandidateRow[]; introducedToday: number };

export async function loadQueueInputs(db: Db, a: QueueArgs): Promise<QueueInputs> {
  // Kid profiles never see phrase cards (even ones created before they became a kid profile).
  const rows = await loadCandidates(db, a.profileId, a.lang, !a.isKid);
  return { rows, introducedToday: await introducedSince(db, a.profileId, a.lang, a.dayStart) };
}

/**
 * Today's queue for one language from loaded inputs. `wordIds` (an album) only filters which
 * cards take part; the FSRS schedule is shared, and the daily new-card limit still counts the whole
 * language (`introducedToday` is not per album). Phrase cards belong to an album through their root
 * word (`cards.word_id`).
 */
export function queueFrom({ rows: all, introducedToday }: QueueInputs, a: QueueArgs, wordIds?: ReadonlySet<string> | null) {
  const rows = wordIds ? all.filter((r) => wordIds.has(r.card.word_id)) : all;

  // Unlock chain per item (word or phrase): recognition → picture → listening, restricted to the
  // profile's enabled types (M6.6). A disabled type is skipped exactly like a missing one, so with
  // picture off listening waits for recognition — the same path an item with no ready image takes.
  // Cards of a disabled type still get a prev_state here; buildQueue drops them by type anyway.
  const chain = enabledChain(a.cardTypes);
  const stateByType = new Map<CardType, Map<string, number>>();
  for (const type of chain) {
    stateByType.set(type, new Map(rows.filter((r) => r.card.card_type === type).map((r) => [itemKey(r.card), r.card.state])));
  }
  const prevState = (c: typeof cards.$inferSelect) => {
    const position = chain.indexOf(c.card_type);
    if (position <= 0) return null; // the entry type has nothing to wait for (and buildQueue ignores it)
    const key = itemKey(c);
    // Nearest enabled predecessor whose card actually exists for this item.
    for (let i = position - 1; i >= 0; i--) {
      const state = stateByType.get(chain[i]!)!.get(key);
      if (state !== undefined) return state;
    }
    return null;
  };
  const candidates: QueueCandidate[] = rows.map((r) => ({
    id: r.card.id,
    card_type: r.card.card_type,
    state: r.card.state,
    due: r.card.due.getTime(),
    word_created_at: (r.phrase?.created_at ?? r.word.created_at).getTime(),
    prev_state: prevState(r.card),
  }));
  const queue = buildQueue(candidates, {
    now: a.now,
    dayStart: a.dayStart,
    newLimit: a.newLimit,
    introducedToday,
    cardTypes: a.cardTypes,
  });

  const byType: TypeCounts = { recognition: 0, picture: 0, listening: 0 };
  for (const c of [...queue.due, ...queue.newCards]) if (c.card_type in byType) byType[c.card_type as keyof TypeCounts]++;
  return { rows, queue, due: queue.due.length, new: queue.newCards.length, byType };
}

/** The review queue with the cards' words and examples (`/api/review/queue`). */
export async function todaysQueue(db: Db, a: QueueArgs, wordIds?: ReadonlySet<string> | null) {
  const q = queueFrom(await loadQueueInputs(db, a), a, wordIds);
  const exampleMap = await loadExamples(db, a.lang);
  const byId = new Map(q.rows.map((r) => [r.card.id, r]));
  const items = q.queue.ids.map((id) => toQueueItem(byId.get(id)!, exampleMap));
  return { items, due: q.due, new: q.new, byType: q.byType };
}

export type AlbumScope = { id: string; name: string; wordIds: ReadonlySet<string> };

/** Counts for Home (`/api/review/summary`): the language, and each of its albums. No items are built. */
export async function queueSummary(db: Db, a: QueueArgs, albums: AlbumScope[]) {
  const inputs = await loadQueueInputs(db, a);
  const all = queueFrom(inputs, a);
  return {
    due: all.due,
    new: all.new,
    byType: all.byType,
    albums: albums.map((al) => {
      const q = queueFrom(inputs, a, al.wordIds);
      return { id: al.id, name: al.name, due: q.due, new: q.new };
    }),
  };
}
