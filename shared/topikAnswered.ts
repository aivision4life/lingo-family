/**
 * Who gets which question: practice across every paper serves only questions this profile has
 * **already answered**, so the untouched ones stay fresh for a mock test (SPEC F12, M7.27).
 *
 * "Đã làm" has exactly one definition, and it lives on the server: an answer in practice
 * (`topik_attempts`) **or** an answer in a sitting (`topik_test_items.selected_option`). The query
 * side of it is `worker/services/topikAnswered.ts#answeredQuestionIds`; this file is the rule that
 * turns that set into "what a session may serve", which is the part worth testing on its own.
 */
import { topikGroupId } from "./topik";

/** Everything the rule needs of a question: its id and what group it belongs to. */
export type AnsweredGroupable = { id: string; segment_id: string | null; group_key: string | null };

/**
 * Splits questions into the ones an "all papers" practice session may serve and the ones held back
 * for mock tests.
 *
 * **A group is never split.** Two questions sharing one recording or one passage are one screen
 * everywhere else (M7.5/M7.21), so one answered question pulls its whole group into the session —
 * the alternative is hearing a recording and being allowed to answer half of what it asks.
 */
export function splitReservedForTests<T extends AnsweredGroupable>(
  questions: readonly T[],
  answered: ReadonlySet<string>,
): { served: T[]; reserved: T[] } {
  const groupsWithAnAnswer = new Set<string>();
  for (const q of questions) if (answered.has(q.id)) groupsWithAnAnswer.add(topikGroupId(q));
  const served: T[] = [];
  const reserved: T[] = [];
  for (const q of questions) (groupsWithAnAnswer.has(topikGroupId(q)) ? served : reserved).push(q);
  return { served, reserved };
}

// --- "How have I done on this question so far?" (M7.30) -----------------------------------------

/**
 * One answer this profile has ever given on one question, from either screen.
 *
 * The same "đã làm" as `answeredQuestionIds` above, only counted instead of collected: one event
 * per answer, so "2/4" can be said as well as "đã làm". `worker/services/topikAnswered.ts` is
 * where the events are read; which rows make one is documented there.
 */
export type AnswerEvent = {
  /** When the answer was given, ms since the epoch. */
  at: number;
  correct: boolean;
  /** The sitting it was given in, when it was given in one that has not been graded yet. */
  test_id: string | null;
};

/** How a question stood at one moment: answers given, and how many of them were right. */
export type QuestionHistory = { attempts: number; correct: number };

/** A question nobody has answered yet — "Câu mới". */
export const NO_QUESTION_HISTORY: QuestionHistory = { attempts: 0, correct: 0 };

/**
 * How a question stood **at `asOf`**, ignoring everything answered after it.
 *
 * The cut-off is the whole point on a mock test (M7.30): a sitting shows the numbers as they were
 * when it started and they must not move while it runs, or "2/4" turning into "3/5" would tell the
 * learner they have just answered correctly — feedback a timed exam does not give. `excludeTestId`
 * drops the sitting's own answers for the same reason, because an answer given in the very first
 * second of the paper is not history, it is this paper.
 */
export function historyAsOf(
  events: readonly AnswerEvent[] | undefined,
  asOf: number,
  excludeTestId: string | null = null,
): QuestionHistory {
  let attempts = 0;
  let correct = 0;
  for (const e of events ?? []) {
    if (e.at > asOf) continue;
    if (excludeTestId !== null && e.test_id === excludeTestId) continue;
    attempts += 1;
    if (e.correct) correct += 1;
  }
  return { attempts, correct };
}

/** True when nothing had ever been answered on this question — the "Câu mới" badge. */
export const isNewQuestion = (history: QuestionHistory) => history.attempts === 0;

/**
 * A sitting's score split into the questions it met for the first time and the ones it had seen
 * before (the result screen's summary line, M7.30).
 *
 * Worth having as a line of its own: a paper where every fresh question was missed and every known
 * one was right says something a single "32/50" cannot.
 */
export function splitByFamiliarity(
  items: readonly { prior: QuestionHistory; is_correct: boolean }[],
): { fresh: QuestionSplit; seen: QuestionSplit } {
  const fresh: QuestionSplit = { total: 0, correct: 0 };
  const seen: QuestionSplit = { total: 0, correct: 0 };
  for (const item of items) {
    const side = isNewQuestion(item.prior) ? fresh : seen;
    side.total += 1;
    if (item.is_correct) side.correct += 1;
  }
  return { fresh, seen };
}

/** One side of that split: how many questions, and how many of them were answered correctly. */
export type QuestionSplit = { total: number; correct: number };
