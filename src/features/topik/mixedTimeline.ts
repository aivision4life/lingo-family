// Stitching a mixed paper's clips into one tape (M6.5).
//
// A mixed sitting's clips come from several different mp3s, so there is no single file position to
// read a clock off. This turns them into one **virtual** timeline: clip after clip, each starting
// where the last one ended. Every rule the original paper already has — which question is current,
// how much time is left, when the paper is over, where a park ends — then works unchanged on that
// timeline, instead of being written a second time for the mixed case.
import type { TopikClip } from "@shared/topik";
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

/** Two questions about one clip carry the very same clip, so it is played once. */
const keyOf = (clip: TopikClip) => `${clip.audio_key}@${clip.start_ms}`;

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
