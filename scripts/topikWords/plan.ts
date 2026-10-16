// Pure parts of the one-off TOPIK vocabulary batch (M6.2): no D1/LLM access here, so easy to test.
import type { TopikOptions } from "../../shared/topik";

export type PendingRow = {
  id: string;
  exam: string;
  number: number;
  stem_text: string | null;
  options: TopikOptions;
  vocab_checked_at: number | null;
};

/**
 * The text vocabulary is generated from — the same rule as
 * worker/services/topikWord.ts#topikVocabSourceText, duplicated here on purpose: scripts/
 * compiles under tsconfig.node.json (no Workers ambient types), and importing that module would
 * transitively pull in worker/env.ts's `Env` type through `./enrich` (see CLAUDE.md's lesson on
 * scripts/assignCreator's D1Like / scripts/topikImport's R2Like for the same reason).
 * Stem + each option, never `instruction` (it just repeats the same question-format boilerplate
 * across every question in a block).
 */
export function questionVocabText(q: Pick<PendingRow, "stem_text" | "options">): string {
  return [q.stem_text, ...q.options.map((o) => o.text)]
    .filter((t): t is string => t !== null && t.trim() !== "")
    .join("\n");
}

/** Rows still needing generation: never checked before, or every row when `force` redoes them all. */
export function selectPending<T extends { vocab_checked_at: number | null }>(rows: T[], force: boolean): T[] {
  return force ? rows : rows.filter((r) => r.vocab_checked_at === null);
}

/** How many of `rows` will actually call the LLM (a row with nothing to tokenize gets `vocab: []` for free). */
export function estimateCalls(rows: Pick<PendingRow, "stem_text" | "options">[]): number {
  return rows.filter((r) => questionVocabText(r).trim() !== "").length;
}
