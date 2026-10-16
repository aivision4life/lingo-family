// Pure parts of the one-off TOPIK answer-explanation batch (M6.3): no D1/LLM access here.
import type { TopikOptions, TopikVocabEntry } from "../../shared/topik";

export type PendingRow = {
  id: string;
  exam: string;
  number: number;
  instruction: string | null;
  stem_text: string | null;
  /** Carried only so run.ts can rebuild the exact same ExplainInput as the route (cache parity). */
  stem_image_key: string | null;
  options: TopikOptions;
  correct_option: number;
  vocab: TopikVocabEntry[];
  explain_checked_at: number | null;
};

/** Mirrors worker/services/topikExplain.ts#topikExplainHasContent (duplicated for the same reason
 * as scripts/topikWords/plan.ts#questionVocabText — see its comment). */
export function questionHasContent(q: Pick<PendingRow, "instruction" | "stem_text" | "options">): boolean {
  return [q.instruction, q.stem_text, ...q.options.map((o) => o.text)].some((t) => t !== null && t.trim() !== "");
}

/** Rows still needing an explanation: never checked before, or every row when `force` redoes them all. */
export function selectPending<T extends { explain_checked_at: number | null }>(rows: T[], force: boolean): T[] {
  return force ? rows : rows.filter((r) => r.explain_checked_at === null);
}

/** How many of `rows` will actually call the LLM (a row with nothing to explain is free). */
export function estimateCalls(rows: Pick<PendingRow, "instruction" | "stem_text" | "options">[]): number {
  return rows.filter((r) => questionHasContent(r)).length;
}
