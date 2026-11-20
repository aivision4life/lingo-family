// What the lock screen and the car's head unit do, decided here rather than in the component
// (SPEC F13, M8.2).
//
// In a car nobody is looking at the screen: the only controls are the four on the steering wheel
// and whatever the head unit draws by itself. So which button means what, and what the system is
// told the podcast is doing, are the whole feature — and neither can be tried out in a unit test
// against a real head unit. They are pure functions instead, and the component does nothing but
// hand the browser their answers.
//
// Two rules of F13 live here:
//
//  - **Previous replays THIS question**, from its first track, and never steps back one. "Say
//    that again" is wanted ten times more often than "take me back one question", and Previous is
//    the only button that can be reached without looking.
//  - **The gap is playing.** The thinking gap has no file (M8.1) but the podcast has not stopped,
//    and a head unit told `paused` draws a stopped podcast and may hand the audio to something
//    else. Playing is playing, silence included.
import type { PodcastQuestion } from "@shared/podcast";
import { nextQuestionStart, podcastPositionAt, podcastQuestionStart, type PodcastStep, type PodcastTape } from "./podcastTape";

/** The Media Session actions the podcast answers; anything else is left to the browser. */
export const PODCAST_MEDIA_ACTIONS = ["play", "pause", "nexttrack", "previoustrack", "stop"] as const;
export type PodcastMediaAction = (typeof PODCAST_MEDIA_ACTIONS)[number];

/** What the player should do about it. `none` is a button that is right but has nothing to do. */
export type PodcastCommand = { kind: "none" } | { kind: "toggle" } | { kind: "jump"; index: number } | { kind: "stop" };

/** What the tape looks like to the buttons. A tape that has not been started yet answers nothing. */
export type PodcastControlState = { started: boolean; playing: boolean; finished: boolean; index: number };

/**
 * Which button does what.
 *
 * `play` and `pause` arrive as two separate actions while the tape has one toggle, so each is
 * answered only when the tape is in the other state: a head unit that sends `play` to something
 * already playing must not pause it, which is exactly what a bare toggle would do.
 */
export function podcastCommandFor(action: PodcastMediaAction, tape: PodcastTape, state: PodcastControlState): PodcastCommand {
  if (!state.started) return { kind: "none" };
  if (action === "stop") return { kind: "stop" };
  if (state.finished) return { kind: "none" };
  switch (action) {
    case "play":
      return state.playing ? { kind: "none" } : { kind: "toggle" };
    case "pause":
      return state.playing ? { kind: "toggle" } : { kind: "none" };
    case "nexttrack": {
      const next = nextQuestionStart(tape, state.index);
      return next === null ? { kind: "none" } : { kind: "jump", index: next };
    }
    case "previoustrack":
      // F13: this question again from its first track, never one question back.
      return { kind: "jump", index: podcastQuestionStart(tape, state.index) };
  }
}

/**
 * What the system is told the podcast is doing.
 *
 * `none` takes the controls off the lock screen, so it is only ever right before the first tap
 * and after the last answer. A gap, and a piece being fetched, are both `playing`.
 */
export function podcastPlaybackState(state: Pick<PodcastControlState, "started" | "playing" | "finished">): MediaSessionPlaybackState {
  if (!state.started || state.finished) return "none";
  return state.playing ? "playing" : "paused";
}

/** What the lock screen says: which question, from which paper, and the piece being read. */
export type PodcastNowPlaying = { position: number; total: number; number: number; exam: string; step: PodcastStep };

export function podcastNowPlaying(tape: PodcastTape, questions: readonly PodcastQuestion[], index: number): PodcastNowPlaying | null {
  const at = podcastPositionAt(tape, index);
  const question = questions[at.question];
  if (!question) return null;
  return { position: at.question + 1, total: questions.length, number: question.number, exam: question.exam, step: at.step };
}
