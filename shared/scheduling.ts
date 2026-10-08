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
  /** State of the recognition card of the same word (listening cards wait for it). */
  recognition_state: number | null;
};

export type QueueOptions = {
  now: Date;
  /** Local midnight of today (see localDayStart). */
  dayStart: Date;
  /** Profile setting `daily_new_limit`, applied to this language. */
  newLimit: number;
  /** New recognition cards of this language already reviewed today. */
  introducedToday: number;
};

/**
 * Today's queue for one language (ids in order):
 * 1. due cards: learning cards up to 20 min ahead, review cards due before the end of today;
 * 2. new listening cards whose recognition card was already reviewed (not limited);
 * 3. new recognition cards, at most `newLimit - introducedToday`.
 */
export function buildQueue(cands: QueueCandidate[], o: QueueOptions) {
  const now = o.now.getTime();
  const endOfDay = o.dayStart.getTime() + DAY_MS;
  const byWordAge = (a: QueueCandidate, b: QueueCandidate) => a.word_created_at - b.word_created_at || a.id.localeCompare(b.id);

  const due = cands
    .filter((c) => c.state !== State.New && c.due <= (isLearning(c.state) ? now + LEARN_AHEAD_MS : endOfDay - 1))
    .sort((a, b) => a.due - b.due);
  const newListening = cands
    .filter((c) => c.state === State.New && c.card_type === "listening")
    .filter((c) => c.recognition_state !== null && c.recognition_state !== State.New)
    .sort(byWordAge);
  const newRecognition = cands
    .filter((c) => c.state === State.New && c.card_type === "recognition")
    .sort(byWordAge)
    .slice(0, Math.max(0, o.newLimit - o.introducedToday));

  return { due, newCards: [...newListening, ...newRecognition], ids: [...due, ...newListening, ...newRecognition].map((c) => c.id) };
}

/** Whether an answered card should come back in the same session. */
export const repeatsInSession = (card: CardFields, now: Date) =>
  isLearning(card.state) && card.due.getTime() <= now.getTime() + LEARN_AHEAD_MS;
