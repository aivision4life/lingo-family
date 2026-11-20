// What the podcast screen says about a piece it could not play (SPEC F13).
//
// Pure, so the sentence can be tested: the person reading it is the one who has to report the
// fault, and a line that names the wrong question is worse than no line at all.
import type { TapeFailure } from "./mixedTape";
import { podcastPositionAt, type PodcastStep, type PodcastTape } from "./podcastTape";
import type { PodcastPlaylist } from "@shared/podcast";

/** One lost piece, as the screen needs it: which question, which piece, and why. */
export type PodcastSkip = { index: number; number: number; step: PodcastStep; reason: TapeFailure };

/**
 * Turns "track 27 was skipped" into "question 6, the four options, timed out".
 *
 * The gap is never skipped — it owns no file — and a track outside the tape cannot be described,
 * so both are dropped rather than guessed at.
 */
export function describeSkip(
  tape: PodcastTape,
  questions: PodcastPlaylist["questions"],
  skip: { index: number; reason: TapeFailure },
): PodcastSkip | null {
  if (skip.index < 0 || skip.index >= tape.at.length) return null;
  const { question, step } = podcastPositionAt(tape, skip.index);
  const number = questions[question]?.number;
  if (number === undefined || step === "gap") return null;
  return { index: skip.index, number, step, reason: skip.reason };
}

/** The same piece twice says nothing twice: one line per track, in the order they were lost. */
export function addSkip(skips: readonly PodcastSkip[], skip: PodcastSkip): PodcastSkip[] {
  return skips.some((s) => s.index === skip.index) ? [...skips] : [...skips, skip];
}
