// Pure rules for a mock test (M6.4): which questions a sitting covers, where its audio runs, and
// what it scored. No D1/R2 here, so each rule is unit tested on its own.
import { DEFAULT_QUESTION_POINTS, type TopikTestLength } from "../../shared/topik";

/** How many questions each offered length covers. "full" means whatever the paper has ready. */
export function lengthQuestionCount(length: TopikTestLength, ready: number): number {
  return length === "full" ? ready : length;
}

/**
 * Whether a paper's ready questions run 1, 2, 3, … with no hole.
 *
 * A test called "questions 1-20" must be questions 1-20. A paper missing number 7 would quietly
 * become a 19-question test with a different mix, and the score would not compare with anyone
 * else's — so a paper with a hole offers no lengths at all until the hole is filled.
 */
export function isContiguousFromOne(numbers: readonly number[]): boolean {
  if (numbers.length === 0) return false;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted.every((n, i) => n === i + 1);
}

export type TestLengthOption = { length: TopikTestLength; available: boolean; questions: number };

/**
 * The three lengths, each with whether it can be taken. A length longer than the paper has ready
 * is offered but disabled — showing it greyed out says "this exists, it is not ready yet", which
 * is the actual situation while a paper is still being typed up.
 */
export function lengthOptions(ready: number, contiguous: boolean): TestLengthOption[] {
  const fixed = [20, 30] as const;
  const options = fixed.map((length) => ({ length: length as TopikTestLength, available: contiguous && ready >= length, questions: length }));
  return [...options, { length: "full" as const, available: contiguous && ready > 0, questions: ready }];
}

/**
 * The span of the exam's mp3 a sitting plays, from the first clip's start to the last clip's end.
 *
 * One span, not one per question: an approved exam's clips are contiguous by construction (the
 * review screen refuses a gap or an overlap), so the tape runs straight through the answering
 * silences exactly as the real exam paces them. Returns null when no position has a clip, which is
 * what a reading test looks like.
 */
export function audioSpan(clips: readonly { start_ms: number; end_ms: number }[]): { start_ms: number; end_ms: number } | null {
  if (clips.length === 0) return null;
  return {
    start_ms: Math.min(...clips.map((c) => c.start_ms)),
    end_ms: Math.max(...clips.map((c) => c.end_ms)),
  };
}

export type ScoredItem = { points: number; is_correct: boolean | null };

/**
 * What a sitting scored. An unanswered position counts as wrong, not as skipped: the tape ran past
 * it, which in a real exam is a lost mark.
 */
export function scoreTest(items: readonly ScoredItem[]): { correct_count: number; score_points: number; total_points: number } {
  return items.reduce(
    (total, item) => ({
      correct_count: total.correct_count + (item.is_correct ? 1 : 0),
      score_points: total.score_points + (item.is_correct ? item.points : 0),
      total_points: total.total_points + item.points,
    }),
    { correct_count: 0, score_points: 0, total_points: 0 },
  );
}

/** A question's worth, falling back to the default when the row somehow has none. */
export const pointsOf = (points: number | null | undefined) =>
  typeof points === "number" && points > 0 ? points : DEFAULT_QUESTION_POINTS;
