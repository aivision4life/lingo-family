// The tape's playlist, and which `<audio>` element each piece of it plays on — the pure part of
// `mixedTape.ts`, split out so it can be tested without a browser.
import type { TopikClip } from "@shared/topik";

/** A piece of tape. The mixed sitting uses `clip` only; the podcast uses all three. */
export type TapeTrack =
  | ({ kind: "clip" } & TopikClip)
  | { kind: "file"; audio_key: string }
  | { kind: "silence"; ms: number };

/** The sitting's own playlist: every clip of the paper, in order. */
export const clipTracks = (clips: readonly TopikClip[]): TapeTrack[] => clips.map((c) => ({ kind: "clip", ...c }));

/** A silent gap plays on no element at all; `null` is that, not "the first one". */
export type ElementSlot = 0 | 1 | null;

/**
 * Which of the two elements each track plays on, worked out once for the whole playlist.
 *
 * The two alternate over the tracks that **have** audio. Counting with the track's own index
 * instead (`i % 2`) gave the silent gap a slot it never used, which left the track before the gap
 * and the track after it sharing one element: in a podcast question that is the options and the
 * answer, so preparing the answer re-sourced the very element the options were playing on. Two
 * tracks that are heard one after the other must never meet on the same element.
 */
export function elementSlots(tracks: readonly TapeTrack[]): ElementSlot[] {
  let heard = 0;
  return tracks.map((track) => (track.kind === "silence" ? null : ((heard++ % 2) as 0 | 1)));
}
