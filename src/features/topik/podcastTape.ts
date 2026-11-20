// The podcast as one continuous tape (SPEC F13, M8.1): every question's six pieces laid end to
// end, plus the index that turns "track 27 is playing" back into "question 5, reading the options".
//
// Pure, and tested, because it is the only thing standing between the player's track number and
// what the screen says is happening — and in a car the screen is the one thing nobody is looking
// at, so it has to be right without being watched.
import type { PodcastPlaylist } from "@shared/podcast";
import type { TapeTrack } from "./mixedTape";

/** What is being heard right now, in F13's order. */
export const PODCAST_STEPS = ["number", "question", "clip", "options", "gap", "answer"] as const;
export type PodcastStep = (typeof PODCAST_STEPS)[number];

export type PodcastTape = {
  tracks: TapeTrack[];
  /** For each track: which question it belongs to and which of its six pieces it is. */
  at: { question: number; step: PodcastStep }[];
  /** First track of each question — where "next question" jumps to. */
  starts: number[];
};

export function buildPodcastTape(playlist: Pick<PodcastPlaylist, "questions">): PodcastTape {
  const tracks: TapeTrack[] = [];
  const at: { question: number; step: PodcastStep }[] = [];
  const starts: number[] = [];

  playlist.questions.forEach((question, qi) => {
    starts.push(tracks.length);
    question.tracks.forEach((track, ti) => {
      tracks.push(track);
      // The six pieces are always in F13's order, so position is the step. A playlist that ever
      // carried something else would be a playlist the player could not narrate either.
      at.push({ question: qi, step: PODCAST_STEPS[ti] ?? "answer" });
    });
  });

  return { tracks, at, starts };
}

/** Where the given track sits; out of range (an empty tape) reads as the first question's number. */
export const podcastPositionAt = (tape: PodcastTape, index: number) => tape.at[index] ?? { question: 0, step: "number" as const };

/** The first track of the question after the one playing, or null at the end of the tape. */
export function nextQuestionStart(tape: PodcastTape, index: number): number | null {
  const { question } = podcastPositionAt(tape, index);
  return tape.starts[question + 1] ?? null;
}

/**
 * The first track of the question being played — where "replay this question" goes.
 *
 * F13's rule for Previous, and the reason it is a lookup and not `index - 1`: in a car the only
 * thing ever wanted is this question again from the top.
 */
export const podcastQuestionStart = (tape: PodcastTape, index: number): number =>
  tape.starts[podcastPositionAt(tape, index).question] ?? 0;
