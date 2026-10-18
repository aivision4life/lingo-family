// FSRS scheduling and daily-queue rules, shared by the Worker (authority) and the client
// (interval previews). Pure functions only, so they are easy to unit test.
import { createEmptyCard, fsrs, generatorParameters, State, type Card, type Grade } from "ts-fsrs";
import type { CardType } from "./enums";

/** Library defaults (steps 1m/10m, relearning 10m, retention 0.9) with fuzz off, so previews match the server. */
export const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

/** The ts-fsrs Card fields as stored in the `cards` table (state as its numeric enum value). */
export type CardFields = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: Date | null;
};

/** The ts-fsrs ReviewLog fields as stored in `review_logs` (`review` → `reviewed_at`). */
export type LogFields = {
  rating: number;
  state: number;
  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reviewed_at: Date;
};

export function emptyCardFields(now: Date): CardFields {
  const { last_review, ...card } = createEmptyCard(now);
  return { ...card, last_review: last_review ?? null };
}

const toFsrsCard = ({ last_review, ...f }: CardFields): Card => ({ ...f, last_review: last_review ?? undefined });

/** Applies one rating; returns the new card state and the log row to append. */
export function applyReview(fields: CardFields, rating: Grade, now: Date): { card: CardFields; log: LogFields } {
  const { card, log } = scheduler.next(toFsrsCard(fields), now, rating);
  const { review, ...logRest } = log;
  return {
    card: { ...card, last_review: card.last_review ?? null },
    log: { ...logRest, reviewed_at: review },
  };
}

/** Milliseconds until the card would be due again for each rating (1 Again … 4 Easy). */
export function previewIntervals(fields: CardFields, now: Date): Record<Grade, number> {
  const preview = scheduler.repeat(toFsrsCard(fields), now);
  const ms = (g: Grade) => preview[g].card.due.getTime() - now.getTime();
  return { 1: ms(1), 2: ms(2), 3: ms(3), 4: ms(4) };
}

// --- Daily queue -------------------------------------------------------------

export const LEARN_AHEAD_MS = 20 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the local day containing `now`; `tzOffsetMin` = minutes east of UTC (Korea: +540). */
export function localDayStart(now: Date, tzOffsetMin: number): Date {
  const offsetMs = tzOffsetMin * 60 * 1000;
  return new Date(Math.floor((now.getTime() + offsetMs) / DAY_MS) * DAY_MS - offsetMs);
}

const isLearning = (state: number) => state === State.Learning || state === State.Relearning;

export type QueueCandidate = {
  id: string;
  card_type: CardType;
  state: number;
  due: number;
  /** Order of new cards: older words first. */
  word_created_at: number;
  /**
   * State of the card before this one in the profile's *enabled* unlock chain (null = no such
   * card, which keeps the card locked). Picture waits for recognition; listening waits for
   * picture when the item has one, else for recognition (an item without a ready image has no
   * picture card, and a disabled type is skipped the same way). The entry type ignores this.
   */
  prev_state: number | null;
};

export type QueueOptions = {
  now: Date;
  /** Local midnight of today (see localDayStart). */
  dayStart: Date;
  /** Profile setting `daily_new_limit`, applied to this language. */
  newLimit: number;
  /** New entry-type cards of this language already reviewed today. */
  introducedToday: number;
  /**
   * Profile setting `card_types` (M6.6): the types this profile practises. Cards of any other type
   * are left out of the queue entirely — including due ones — but never deleted or rescheduled, so
   * enabling a type again resumes its old schedule.
   */
  cardTypes: readonly CardType[];
};

/** The unlock chain's fixed order; `speaking` is not a review type yet (M3). */
export const CHAIN_ORDER = ["recognition", "picture", "listening"] as const satisfies readonly CardType[];

/**
 * The enabled types in chain order. The first one is the *entry* type: it has no predecessor to
 * wait for and is the one `newLimit` applies to (normally recognition). Each later type is gated
 * on the nearest enabled type before it, so disabling a type makes it transparent to the chain
 * rather than blocking everything behind it.
 */
export const enabledChain = (cardTypes: readonly CardType[]): CardType[] => CHAIN_ORDER.filter((t) => cardTypes.includes(t));

/**
 * Today's queue for one language (ids in order), using only the profile's enabled `cardTypes`:
 * 1. due cards: learning cards up to 20 min ahead, review cards due before the end of today;
 * 2. new gated cards (every enabled type after the entry type, in chain order) whose previous
 *    card in the chain was already reviewed (not limited);
 * 3. new entry-type cards, at most `newLimit - introducedToday`.
 */
export function buildQueue(cands: QueueCandidate[], o: QueueOptions) {
  const now = o.now.getTime();
  const endOfDay = o.dayStart.getTime() + DAY_MS;
  const byWordAge = (a: QueueCandidate, b: QueueCandidate) => a.word_created_at - b.word_created_at || a.id.localeCompare(b.id);

  const chain = enabledChain(o.cardTypes);
  const [entryType, ...gatedTypes] = chain;
  const enabled = cands.filter((c) => chain.includes(c.card_type));

  const due = enabled
    .filter((c) => c.state !== State.New && c.due <= (isLearning(c.state) ? now + LEARN_AHEAD_MS : endOfDay - 1))
    .sort((a, b) => a.due - b.due);
  const newGated = (type: CardType) =>
    enabled
      .filter((c) => c.state === State.New && c.card_type === type)
      .filter((c) => c.prev_state !== null && c.prev_state !== State.New)
      .sort(byWordAge);
  const newEntry = entryType
    ? enabled
        .filter((c) => c.state === State.New && c.card_type === entryType)
        .sort(byWordAge)
        .slice(0, Math.max(0, o.newLimit - o.introducedToday))
    : [];

  const newCards = [...gatedTypes.flatMap(newGated), ...newEntry];
  return { due, newCards, ids: [...due, ...newCards].map((c) => c.id) };
}

/** Whether an answered card should come back in the same session. */
export const repeatsInSession = (card: CardFields, now: Date) =>
  isLearning(card.state) && card.due.getTime() <= now.getTime() + LEARN_AHEAD_MS;
