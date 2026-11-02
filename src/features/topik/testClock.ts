// Following the tape during a mock test (M6.4). The audio file *is* the clock: there is no
// separate countdown, so everything the screen shows is derived from where the playing head is.
import type { TopikClip } from "@shared/topik";

export type TestPosition = { position: number; clip: TopikClip | null };

/**
 * Which position the tape is on, from the playing head.
 *
 * A clip's own answering silence belongs to it, so the boundary that matters is `end_ms`, not
 * `speech_end_ms`: while the paper leaves 18 seconds to choose, the screen must still be showing
 * the question those seconds belong to. Before the first clip (and for a paper with no audio at
 * all) the first position is current; after the last, the last one is.
 */
export function positionAt(positions: readonly TestPosition[], atMs: number): number | null {
  const withClips = positions.filter((p): p is TestPosition & { clip: TopikClip } => p.clip !== null);
  if (withClips.length === 0) return positions[0]?.position ?? null;
  const current = withClips.find((p) => atMs < p.clip.end_ms);
  return (current ?? withClips[withClips.length - 1]!).position;
}

/** Milliseconds of tape left, never negative — the paper is over when it hits zero. */
export const remainingMs = (atMs: number, endMs: number) => Math.max(0, endMs - atMs);

/** `m:ss`, for a countdown where tenths would only be noise. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Whether the tape has reached the end of the paper, which is what submits it.
 *
 * A small margin, because `timeupdate` fires a few times a second and the last event can land just
 * short of the end: without it a sitting could sit there finished but unsubmitted.
 */
export const END_MARGIN_MS = 250;
export const isFinished = (atMs: number, endMs: number) => atMs >= endMs - END_MARGIN_MS;

/** "18/20 câu" style progress, as a fraction for the bar. */
export const progressFraction = (answered: number, total: number) => (total > 0 ? Math.min(1, answered / total) : 0);

/** Where the learner has parked themselves by using the back/next buttons during a sitting. */
export type ParkedAt = { position: number; tapeWhenParked: number } | null;

/**
 * Which question the screen shows: the tape's, or the one the learner deliberately went back to.
 *
 * Going back to fix an answer has to hold the screen still — being dragged away mid-correction is
 * the whole reason the real exam lets you flip back. But holding it still *forever* is worse: one
 * tap and the paper never advances again, and every question from then on needs a manual "next".
 * So the park ends by itself once both are true: the parked question has an answer, and the tape
 * has moved on to a different question than when the park began. The second half matters — without
 * it, answering the parked question would yank the screen away the instant it was answered.
 */
export function shownPosition(park: ParkedAt, tapePosition: number | null, isAnswered: (position: number) => boolean): number | null {
  if (park === null) return tapePosition;
  if (tapePosition === null || park.position === tapePosition) return park.position;
  if (!isAnswered(park.position)) return park.position;
  return tapePosition === park.tapeWhenParked ? park.position : tapePosition;
}

/** Whether the park is still holding the screen — i.e. whether to offer "back to the tape". */
export const isParked = (park: ParkedAt, shown: number | null, tapePosition: number | null) =>
  park !== null && shown !== tapePosition;
