// Stitching a mixed paper's clips into one tape (M6.5).
//
// A mixed sitting's clips come from several different mp3s, so there is no single file position to
// read a clock off. This turns them into one **virtual** timeline: clip after clip, each starting
// where the last one ended. Every rule the original paper already has — which question is current,
// how much time is left, when the paper is over, where a park ends — then works unchanged on that
// timeline, instead of being written a second time for the mixed case.
import type { TopikClip } from "@shared/topik";
import { clipKeyOf } from "@shared/topikClock";
import type { TestPosition } from "./testClock";

export type MixedTimeline = {
  /** The clips to play, in order, each one only once even when two questions share it. */
  clips: TopikClip[];
  /** Where each clip begins on the stitched tape. */
  offsets: number[];
  /** The questions, with their clip rewritten into stitched-tape milliseconds. */
  positions: TestPosition[];
  /** The whole tape's length, which is the end of the paper. */
  totalMs: number;
};

/** Two questions about one clip carry the very same clip, so it is played once. The key is shared
 * with `tapeLengthMs`, which the server times the paper by: a clip counted twice by one of them and
 * once by the other would make the deadline and the tape disagree. */
const keyOf = (clip: TopikClip) => clipKeyOf(clip);

export function mixedTimeline(questions: readonly TestPosition[]): MixedTimeline {
  const clips: TopikClip[] = [];
  const offsets: number[] = [];
  const indexByKey = new Map<string, number>();
  let total = 0;

  for (const q of questions) {
    if (!q.clip || indexByKey.has(keyOf(q.clip))) continue;
    indexByKey.set(keyOf(q.clip), clips.length);
    clips.push(q.clip);
    offsets.push(total);
    total += q.clip.end_ms - q.clip.start_ms;
  }

  const positions = questions.map((q) => {
    const index = q.clip ? indexByKey.get(keyOf(q.clip)) : undefined;
    if (!q.clip || index === undefined) return { position: q.position, clip: null };
    const offset = offsets[index]!;
    return {
      position: q.position,
      clip: {
        audio_key: q.clip.audio_key,
        start_ms: offset,
        speech_end_ms: offset + (q.clip.speech_end_ms - q.clip.start_ms),
        end_ms: offset + (q.clip.end_ms - q.clip.start_ms),
      },
    };
  });

  return { clips, offsets, positions, totalMs: total };
}

/** Where the tape is on the stitched timeline, from the clip it is on and how far into it. */
export function stitchedPosition(timeline: MixedTimeline, index: number, withinMs: number): number {
  const offset = timeline.offsets[index] ?? timeline.totalMs;
  return Math.min(timeline.totalMs, offset + Math.max(0, withinMs));
}

/**
 * The inverse of `stitchedPosition`: which clip the stitched millisecond falls in, and how far into
 * it (M7.13).
 *
 * This is what resuming a mixed sitting needs. The server says how much exam time has gone; that
 * number has to become "clip 7, 12.4 seconds in" before an `<audio>` element can be seeked. A
 * position past the end of the tape means the paper is over, and is reported as the end of the last
 * clip rather than clamped into it — the caller submits instead of playing.
 */
export function positionOnTimeline(clips: readonly TopikClip[], stitchedMs: number): { index: number; withinMs: number; past: boolean } {
  let offset = 0;
  const seen = new Set<string>();
  const unique = clips.filter((c) => (seen.has(keyOf(c)) ? false : (seen.add(keyOf(c)), true)));
  const target = Math.max(0, stitchedMs);

  for (const [index, clip] of unique.entries()) {
    const length = Math.max(0, clip.end_ms - clip.start_ms);
    // `<` and not `<=`: a position exactly on a boundary belongs to the clip that starts there, so
    // round-tripping the start of clip 7 gives clip 7 at 0 rather than clip 6 at its very end.
    if (target < offset + length) return { index, withinMs: target - offset, past: false };
    offset += length;
  }
  const last = unique.length - 1;
  return { index: Math.max(0, last), withinMs: last < 0 ? 0 : Math.max(0, unique[last]!.end_ms - unique[last]!.start_ms), past: true };
}
