// Pure helpers for the block picker's progress display (M6.9).
import type { TopikBlock } from "@shared/topik";

type Counts = Pick<TopikBlock, "count" | "unseen">;

/**
 * Sums every block for the total row. Blocks never share a question (the server groups by the
 * stored `block` field), so a plain sum is the real total.
 */
export function blockTotals(blocks: readonly Counts[]): { count: number; unseen: number } {
  return blocks.reduce((total, b) => ({ count: total.count + b.count, unseen: total.unseen + b.unseen }), { count: 0, unseen: 0 });
}

/**
 * How far through a block the profile is. The three states are told apart on purpose: "0 left of
 * 7" (finished) and "24 left of 24" (never opened) are both "nothing to do right now" at a glance
 * but mean opposite things, so each gets its own bar fill and its own label.
 */
export function blockProgress(b: Counts): { studied: number; percent: number; status: "done" | "untouched" | "partial" } {
  const studied = Math.max(0, b.count - b.unseen);
  // An empty block cannot be "done" — there is nothing to have finished.
  const percent = b.count > 0 ? Math.round((studied / b.count) * 100) : 0;
  const status = b.count > 0 && b.unseen === 0 ? "done" : studied === 0 ? "untouched" : "partial";
  return { studied, percent, status };
}
