// Pure planning for "assign a creator to words/phrases moved from local that have none" (M2.7).
// Only rows whose created_by_profile is still NULL are ever touched; rows that already have one
// are left alone and reported separately (so a re-run is always idempotent and never overwrites).

export type CreatorRow = {
  table: "words" | "phrases";
  id: string;
  lang: string;
  /** The word's term, or the phrase's text. */
  term: string;
  created_by_profile: string | null;
  /** Epoch ms, for the dry-run listing. */
  created_at: number;
};

export type AssignPlan = {
  /** NULL rows that would get `profileId`. */
  toUpdate: CreatorRow[];
  /** Rows that already have a creator (not touched; shown so the counts explain themselves). */
  alreadySet: CreatorRow[];
};

export function planAssignCreator(rows: CreatorRow[]): AssignPlan {
  return {
    toUpdate: rows.filter((r) => r.created_by_profile === null),
    alreadySet: rows.filter((r) => r.created_by_profile !== null),
  };
}

export const countByTable = (rows: readonly CreatorRow[]) => ({
  words: rows.filter((r) => r.table === "words").length,
  phrases: rows.filter((r) => r.table === "phrases").length,
});
