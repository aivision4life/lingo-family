/**
 * "Câu mới" or "2/4" (M7.30) — the display side of a question's own history.
 *
 * The counting is the server's (`shared/topikAnswered.ts`), and on a sitting it is frozen at the
 * moment the paper started; this file only decides which of the two things to say, and which halves
 * of the result's summary line are worth saying at all. A pure function because the choice has more
 * than two branches once an empty half is in play, and because it is read in three screens.
 */
import type { TopikQuestionHistoryView, TopikTestResult } from "@shared/topik";
import { isNewQuestion } from "@shared/topikAnswered";

/** What to put beside a question: nothing has ever been answered, or how it has gone so far. */
export type PriorLabel = { kind: "new" } | { kind: "count"; correct: number; attempts: number };

export const priorLabel = (prior: TopikQuestionHistoryView): PriorLabel =>
  isNewQuestion(prior) ? { kind: "new" } : { kind: "count", correct: prior.correct, attempts: prior.attempts };

/** One half of the result's summary line. */
export type FamiliaritySide = { kind: "new" | "seen"; total: number; correct: number };

/**
 * The halves of "Câu mới: 3/5 đúng · Câu đã làm: 8/10 đúng".
 *
 * A half with no questions in it is dropped rather than shown as "0/0 đúng": a paper of questions
 * the learner had all seen before has nothing to say about new ones.
 */
export function familiaritySides(result: Pick<TopikTestResult, "new_questions" | "seen_questions">): FamiliaritySide[] {
  return [
    { kind: "new" as const, ...result.new_questions },
    { kind: "seen" as const, ...result.seen_questions },
  ].filter((side) => side.total > 0);
}
