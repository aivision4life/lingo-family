// The words marked on a sitting's **result** screen, kept on the device (M7.19).
//
// The sitting itself needs nothing like this: every answer is written to D1 as it is given and the
// clock is the server's, so a reloaded sitting carries on untouched. Its result screen is the one
// place where work exists only in memory — the terms marked for the library while reading through
// the paper — and that is what this slot holds.
//
// Separate from `sessionProgress.ts` because the two are identified differently: a practice
// session by its block and range, a sitting by its own id.
import { z } from "zod";
import { topikWordSourceSchema } from "@shared/topik";
import type { MarkedTerm } from "./markedWords";
import { SESSION_TTL_MS } from "./sessionProgress";

export const testMarksKey = (profileId: string) => `topik_test_marks_v1_${profileId}`;

const savedTestMarksSchema = z.object({
  v: z.literal(1),
  profile_id: z.string().min(1),
  test_id: z.string().min(1),
  marked: z.array(z.object({ lemma: z.string().min(1), gloss_vi: z.string(), source: topikWordSourceSchema })),
  saved_at: z.number().int(),
});

export type SavedTestMarks = { v: 1; profile_id: string; test_id: string; marked: MarkedTerm[]; saved_at: number };

export function parseTestMarks(raw: string | null): SavedTestMarks | null {
  if (!raw) return null;
  try {
    const parsed = savedTestMarksSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as SavedTestMarks) : null;
  } catch {
    return null;
  }
}

/** Pure: the marks belong to this profile's view of this sitting, and are not stale. An empty
 * list restores as nothing, so a result screen reopened days later shows no stray card. */
export function restoreTestMarks(
  saved: SavedTestMarks | null,
  profileId: string,
  testId: string,
  /** Defaulted here so the call site does not read the clock during render; tests pass it. */
  now: number = Date.now(),
): MarkedTerm[] {
  if (!saved || saved.profile_id !== profileId || saved.test_id !== testId) return [];
  if (now - saved.saved_at > SESSION_TTL_MS) return [];
  return saved.marked;
}

export function readTestMarks(profileId: string): SavedTestMarks | null {
  try {
    return parseTestMarks(localStorage.getItem(testMarksKey(profileId)));
  } catch {
    return null;
  }
}

/** Writes the marks, or removes the slot once they are all safely in the library. */
export function writeTestMarks(profileId: string, testId: string, marked: MarkedTerm[]): void {
  try {
    if (marked.length === 0) {
      localStorage.removeItem(testMarksKey(profileId));
      return;
    }
    const record: SavedTestMarks = { v: 1, profile_id: profileId, test_id: testId, marked, saved_at: Date.now() };
    localStorage.setItem(testMarksKey(profileId), JSON.stringify(record));
  } catch {
    // The marks just will not survive a reload, as before M7.19.
  }
}
