// Pure, unit-tested parts of `npm run topik-groups` (M7.21): deciding which stored question gets
// which `group_key`, and what disagrees. No file, network or D1 access here — see run.ts for that.
//
// The groups themselves are not decided here: `assignGroupKeys`
// (worker/services/topikImport.ts) already does that from the Word files' `CHUNG ĐOẠN` marks, and
// having a second rule for the same thing is the mistake this whole milestone is about. This module
// only matches what the files say onto the rows that exist.

/** A stored question, as the backfill reads it. */
export type StoredRow = { id: string; section: string; exam: string; number: number; group_key: string | null; stem_text: string | null };

/** What the Word files say about one question. */
export type FileGroup = { section: string; exam: string; number: number; group_key: string | null };

export type Change = { id: string; section: string; exam: string; number: number; from: string | null; to: string | null };

export type BackfillPlan = {
  /** Rows whose `group_key` the files disagree with — the UPDATEs to run. */
  changes: Change[];
  /** Rows already correct. */
  unchanged: number;
  /** Rows in the bank that no Word file covers: left exactly as they are, and named. */
  orphans: StoredRow[];
  /** Questions the files describe that the bank does not have — the import has not been run. */
  missing: FileGroup[];
};

const keyOf = (section: string, exam: string, number: number) => `${section}|${exam}|${number}`;

/**
 * What to change, and nothing else.
 *
 * Deliberately **not** "set every row from the files": a row the files no longer cover (an exam
 * typed up, then the file renamed) must not have its key cleared as a side effect of a backfill, so
 * it is reported as an orphan and skipped. The only writes are rows the files actually describe.
 *
 * A row that already carries the right key produces no change at all, which is what makes this
 * script safe to run twice — and what makes "0 changes" the expected second run.
 */
export function planBackfill(stored: readonly StoredRow[], fromFiles: readonly FileGroup[]): BackfillPlan {
  const byQuestion = new Map(fromFiles.map((f) => [keyOf(f.section, f.exam, f.number), f]));
  const storedKeys = new Set(stored.map((r) => keyOf(r.section, r.exam, r.number)));
  const changes: Change[] = [];
  const orphans: StoredRow[] = [];
  let unchanged = 0;
  for (const row of stored) {
    const fromFile = byQuestion.get(keyOf(row.section, row.exam, row.number));
    if (!fromFile) {
      orphans.push(row);
      continue;
    }
    if (fromFile.group_key === row.group_key) {
      unchanged += 1;
      continue;
    }
    changes.push({ id: row.id, section: row.section, exam: row.exam, number: row.number, from: row.group_key, to: fromFile.group_key });
  }
  const missing = fromFiles.filter((f) => !storedKeys.has(keyOf(f.section, f.exam, f.number)));
  return { changes, unchanged, orphans, missing };
}

/** One line per group the files describe, for the report: which questions end up together. */
export function groupSummary(fromFiles: readonly FileGroup[]): { group_key: string; section: string; exam: string; numbers: number[] }[] {
  const byKey = new Map<string, { group_key: string; section: string; exam: string; numbers: number[] }>();
  for (const f of fromFiles) {
    if (f.group_key === null) continue;
    const found = byKey.get(f.group_key) ?? { group_key: f.group_key, section: f.section, exam: f.exam, numbers: [] };
    found.numbers.push(f.number);
    byKey.set(f.group_key, found);
  }
  for (const g of byKey.values()) g.numbers.sort((a, b) => a - b);
  return [...byKey.values()].sort((a, b) => a.group_key.localeCompare(b.group_key));
}

/**
 * Groups whose members' stored stem text is not identical (M7.21).
 *
 * The same check the import runs, applied to what the backfill is about to group together: once two
 * rows share a key, the app treats them as one passage, so a drift between them stops being a
 * curiosity and starts being two different passages on one screen. Reported, never repaired — which
 * of the two texts is right is not something a script can know.
 */
export function stemDrift(
  stored: readonly StoredRow[],
  fromFiles: readonly FileGroup[],
): { group_key: string; members: { number: number; stem_text: string | null }[] }[] {
  const byQuestion = new Map(fromFiles.map((f) => [keyOf(f.section, f.exam, f.number), f]));
  const byKey = new Map<string, { number: number; stem_text: string | null }[]>();
  for (const row of stored) {
    const key = byQuestion.get(keyOf(row.section, row.exam, row.number))?.group_key;
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), { number: row.number, stem_text: row.stem_text }]);
  }
  const out: { group_key: string; members: { number: number; stem_text: string | null }[] }[] = [];
  for (const [group_key, members] of byKey) {
    const first = members[0]!;
    if (members.some((m) => m.stem_text !== first.stem_text)) {
      out.push({ group_key, members: [...members].sort((a, b) => a.number - b.number) });
    }
  }
  return out.sort((a, b) => a.group_key.localeCompare(b.group_key));
}
