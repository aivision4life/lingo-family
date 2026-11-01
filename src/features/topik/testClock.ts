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
