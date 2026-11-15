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
