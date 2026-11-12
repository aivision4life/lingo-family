// TOPIK practice session ordering (M6.1). Reuses the generic FSRS wrapper in
// shared/scheduling.ts (applyReview/emptyCardFields) — this is just the "which ~10 questions do we
// show" rule, with no card types, unlock chains or daily new-card limit (unlike word review).
import type { CardFields } from "../../shared/scheduling";
import { TOPIK_SESSION_SIZE, type TopikSessionMode } from "../../shared/topik";

/**
 * Whether answering this question now is a real review (M7.24).
 *
 * One definition, two readers: the session builder orders by it, and `POST /topik/attempts`
 * decides from it whether the answer may move the FSRS schedule. A question with no card has
 * never been answered, and a first answer is exactly what the schedule wants, so it counts.
 *
 * This is deliberately **not** something the client says. It used to be: the practice screen sent
 * `schedule: mode === "due"`, so a client bug — or an old build on a phone — could quietly write
 * FSRS state for questions that were not due, and nothing downstream could tell. The server has
 * the card and the clock; it is the only place that cannot be lied to.
 */
export const isDueNow = (card: CardFields | null, now: Date): boolean => card === null || card.due.getTime() <= now.getTime();

export type TopikCandidate = {
  question_id: string;
  /**
   * The questions asked about one recording share a group (M7.5): the clip's id, or the question's
   * own id when it has no clip. A session takes whole groups — the tape plays once, so a pair
   * split across two sessions would be unanswerable in the second.
   */
  group_id: string;
  /** null = no `topik_cards` row yet (never attempted). */
  card: CardFields | null;
};

/**
 * Picks up to `limit` questions for one practice session: overdue questions the profile has
 * gotten wrong before (`lapses > 0`) first, then never-attempted questions, then other due
 * questions — "câu hay sai lên trước, rồi câu chưa làm, rồi câu đúng đến hạn". A question not yet
 * due (and never gotten wrong) is left out entirely — unless `mode` is "all", which adds those as
 * a final tier for a deliberate practise-anyway session. `cands` should already be in a stable
 * order (e.g. by question number) so ties within a tier stay predictable. `limit` is the profile's
 * own `session_size` (M6.13); the default here is only the fallback.
 */
export function buildTopikSession(
  cands: TopikCandidate[],
  now: Date,
  mode: TopikSessionMode = "due",
  limit: number = TOPIK_SESSION_SIZE,
): string[] {
  // `isDueNow` also answers true for a question with no card; these tiers want "has a card AND it
  // is due", because a never-attempted question is its own tier below.
  const isDue = (c: TopikCandidate) => c.card !== null && isDueNow(c.card, now);
  const byDue = (a: TopikCandidate, b: TopikCandidate) => a.card!.due.getTime() - b.card!.due.getTime();

  const overdueWrong = cands.filter((c) => isDue(c) && c.card!.lapses > 0).sort(byDue);
  const neverAttempted = cands.filter((c) => c.card === null);
  const overdueClean = cands.filter((c) => isDue(c) && c.card!.lapses === 0).sort(byDue);
  // "all": whatever the schedule says is not ready yet, soonest first, after everything that is.
  // Same tiers in the same order, so a practise-anyway session still leads with the questions that
  // need the work rather than reading like a different exercise.
  const notDueYet = mode === "all" ? cands.filter((c) => c.card !== null && !isDue(c)).sort(byDue) : [];

  const ordered = [...overdueWrong, ...neverAttempted, ...overdueClean, ...notDueYet];
  return takeWholeGroups(ordered, cands, limit);
}

/**
 * Cuts the ordered list at `limit` questions **without ever splitting a group**.
 *
 * A group that straddles the limit is taken whole, so a 5-question session can come back with 6.
 * That is deliberate: a group is at most two questions, so the overshoot is at most one, while
 * stopping short would throw away a prepared pair — and the real waste is hearing a recording and
 * being allowed to answer only half of what it asks. The session length is "how long do I want to
 * sit for", not a contract.
 */
function takeWholeGroups(ordered: readonly TopikCandidate[], all: readonly TopikCandidate[], limit: number): string[] {
  const members = new Map<string, TopikCandidate[]>();
  for (const c of all) members.set(c.group_id, [...(members.get(c.group_id) ?? []), c]);

  const taken: string[] = [];
  const done = new Set<string>();
  for (const candidate of ordered) {
    if (taken.length >= limit) break;
    if (done.has(candidate.group_id)) continue;
    done.add(candidate.group_id);
    // In the order the questions were given (by number), so a pair reads 21 then 22.
    for (const member of members.get(candidate.group_id) ?? [candidate]) taken.push(member.question_id);
  }
  return taken;
}
