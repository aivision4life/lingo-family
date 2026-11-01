// TOPIK practice session ordering (M6.1). Reuses the generic FSRS wrapper in
// shared/scheduling.ts (applyReview/emptyCardFields) — this is just the "which ~10 questions do we
// show" rule, with no card types, unlock chains or daily new-card limit (unlike word review).
import type { CardFields } from "../../shared/scheduling";
import { TOPIK_SESSION_SIZE, type TopikSessionMode } from "../../shared/topik";

export type TopikCandidate = {
  question_id: string;
  /** null = no `topik_cards` row yet (never attempted). */
  card: CardFields | null;
};

/**
 * Picks up to `limit` questions for one practice session: overdue questions the profile has
 * gotten wrong before (`lapses > 0`) first, then never-attempted questions, then other due
 * questions — "câu hay sai lên trước, rồi câu chưa làm, rồi câu đúng đến hạn". A question not yet
 * due (and never gotten wrong) is left out entirely — unless `mode` is "all", which adds those as
 * a final tier for a deliberate practise-anyway session. `cands` should already be in a stable
 * order (e.g. by question number) so ties within a tier stay predictable.
 */
export function buildTopikSession(
  cands: TopikCandidate[],
  now: Date,
  mode: TopikSessionMode = "due",
  limit = TOPIK_SESSION_SIZE,
): string[] {
  const nowMs = now.getTime();
  const isDue = (c: TopikCandidate) => c.card !== null && c.card.due.getTime() <= nowMs;
  const byDue = (a: TopikCandidate, b: TopikCandidate) => a.card!.due.getTime() - b.card!.due.getTime();

  const overdueWrong = cands.filter((c) => isDue(c) && c.card!.lapses > 0).sort(byDue);
  const neverAttempted = cands.filter((c) => c.card === null);
  const overdueClean = cands.filter((c) => isDue(c) && c.card!.lapses === 0).sort(byDue);
  // "all": whatever the schedule says is not ready yet, soonest first, after everything that is.
  // Same tiers in the same order, so a practise-anyway session still leads with the questions that
  // need the work rather than reading like a different exercise.
  const notDueYet = mode === "all" ? cands.filter((c) => c.card !== null && !isDue(c)).sort(byDue) : [];

  return [...overdueWrong, ...neverAttempted, ...overdueClean, ...notDueYet].slice(0, limit).map((c) => c.question_id);
}
