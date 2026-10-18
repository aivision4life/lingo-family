// Pure helper for the block picker's bottom "total" row (M6.9).
import type { TopikBlock } from "@shared/topik";

/**
 * Sums every block's question counts for the total row. Blocks never share a question (the server
 * groups by the stored `block` field), so a plain sum is the real total.
 */
export function blockTotals(blocks: readonly Pick<TopikBlock, "count" | "unseen">[]): { count: number; unseen: number } {
  return blocks.reduce((total, b) => ({ count: total.count + b.count, unseen: total.unseen + b.unseen }), { count: 0, unseen: 0 });
}
