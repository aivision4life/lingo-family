// Pure helpers for the block picker's progress display (M6.9; mastered split M6.11).
import type { TopikBlock } from "@shared/topik";

type Counts = Pick<TopikBlock, "count" | "unseen" | "mastered">;

/**
 * Sums every block for the total row. Blocks never share a question (the server groups by the
 * stored `block` field), so a plain sum is the real total.
 */
export function blockTotals(blocks: readonly Counts[]): Counts {
  return blocks.reduce(
    (total, b) => ({ count: total.count + b.count, unseen: total.unseen + b.unseen, mastered: total.mastered + b.mastered }),
    { count: 0, unseen: 0, mastered: 0 },
  );
}

/**
 * How far through a block the profile is.
 *
 * The bar has two filled segments — mastered, then "answered but not mastered yet" — so the three
 * states are told apart on purpose: "0 left of 7" (finished) and "24 left of 24" (never opened)
 * are both "nothing to do right now" at a glance but mean opposite things.
 *
 * `mastered` comes from the cards table and `unseen` from the attempts table, so a half-written
 * state (a card row without its attempt row) could in principle make them overlap; the learning
 * segment is clamped at 0 rather than rendering a negative width.
 */
export function blockProgress(b: Counts): {
  studied: number;
  /** Width of the dark segment: questions whose card reached ts-fsrs Review. */
  masteredPercent: number;
  /** Width of the lighter segment right after it: answered, not mastered yet. */
  learningPercent: number;
  status: "done" | "untouched" | "partial";
} {
  const studied = Math.max(0, b.count - b.unseen);
  const mastered = Math.min(b.mastered, studied);
  const pct = (n: number) => (b.count > 0 ? Math.round((n / b.count) * 100) : 0);
  // An empty block cannot be "done" — there is nothing to have finished.
  const status = b.count > 0 && b.unseen === 0 ? "done" : studied === 0 ? "untouched" : "partial";
  return { studied, masteredPercent: pct(mastered), learningPercent: pct(studied - mastered), status };
}
