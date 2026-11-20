import { describe, expect, it } from "vitest";
import { PODCAST_GAP_MS, type PodcastQuestion } from "@shared/podcast";
import { podcastCommandFor, podcastNowPlaying, podcastPlaybackState, type PodcastControlState } from "./podcastMediaSession";
import { buildPodcastTape } from "./podcastTape";

const question = (number: number): PodcastQuestion => ({
  id: `q${number}`,
  exam: "Listen-60회",
  number,
  question_line: "다음을 듣고 물음에 답하십시오.",
  tracks: [
    { kind: "file", audio_key: `n${number}` },
    { kind: "file", audio_key: `line${number}` },
    { kind: "clip", audio_key: "paper.mp3", start_ms: 0, speech_end_ms: 20_000, end_ms: 26_000 },
    { kind: "file", audio_key: `opt${number}` },
    { kind: "silence", ms: PODCAST_GAP_MS },
    { kind: "file", audio_key: `ans${number}` },
  ],
});

const questions = [question(4), question(5)];
const tape = buildPodcastTape({ questions });
const playing = (index: number): PodcastControlState => ({ started: true, playing: true, finished: false, index });

describe("podcastCommandFor", () => {
  it("Previous replays this question from its first track, never one question back", () => {
    // The answer of question 5 is track 11; Previous goes to 6, the start of question 5.
    expect(podcastCommandFor("previoustrack", tape, playing(11))).toEqual({ kind: "jump", index: 6 });
    // And on the very first question it is still a replay, not a dead button.
    expect(podcastCommandFor("previoustrack", tape, playing(3))).toEqual({ kind: "jump", index: 0 });
  });

  it("Next goes to the next question, and does nothing on the last one", () => {
    expect(podcastCommandFor("nexttrack", tape, playing(2))).toEqual({ kind: "jump", index: 6 });
    expect(podcastCommandFor("nexttrack", tape, playing(8))).toEqual({ kind: "none" });
  });

  it("play and pause are each answered only from the other state", () => {
    expect(podcastCommandFor("play", tape, playing(0))).toEqual({ kind: "none" });
    expect(podcastCommandFor("pause", tape, playing(0))).toEqual({ kind: "toggle" });
    const paused = { ...playing(0), playing: false };
    expect(podcastCommandFor("play", tape, paused)).toEqual({ kind: "toggle" });
    expect(podcastCommandFor("pause", tape, paused)).toEqual({ kind: "none" });
  });

  it("works inside the gap, which is a track like any other", () => {
    // Track 4 is question 4's gap: Previous still replays the question, Next still moves on.
    expect(podcastCommandFor("previoustrack", tape, playing(4))).toEqual({ kind: "jump", index: 0 });
    expect(podcastCommandFor("nexttrack", tape, playing(4))).toEqual({ kind: "jump", index: 6 });
  });

  it("answers nothing before the first tap, and nothing but stop once it is over", () => {
    const idle = { started: false, playing: false, finished: false, index: 0 };
    for (const action of ["play", "pause", "nexttrack", "previoustrack", "stop"] as const) {
      expect(podcastCommandFor(action, tape, idle)).toEqual({ kind: "none" });
    }
    const done = { started: true, playing: false, finished: true, index: 11 };
    expect(podcastCommandFor("play", tape, done)).toEqual({ kind: "none" });
    expect(podcastCommandFor("nexttrack", tape, done)).toEqual({ kind: "none" });
    expect(podcastCommandFor("stop", tape, done)).toEqual({ kind: "stop" });
  });
});

describe("podcastPlaybackState", () => {
  it("is playing through the gap, which has no file but has not stopped", () => {
    expect(podcastPlaybackState({ started: true, playing: true, finished: false })).toBe("playing");
  });

  it("is paused when the listener or a phone call stopped it", () => {
    expect(podcastPlaybackState({ started: true, playing: false, finished: false })).toBe("paused");
  });

  it("takes the controls away only before the first tap and after the last answer", () => {
    expect(podcastPlaybackState({ started: false, playing: false, finished: false })).toBe("none");
    expect(podcastPlaybackState({ started: true, playing: false, finished: true })).toBe("none");
  });
});

describe("podcastNowPlaying", () => {
  it("names the question, the paper and the piece being read", () => {
    expect(podcastNowPlaying(tape, questions, 9)).toEqual({ position: 2, total: 2, number: 5, exam: "Listen-60회", step: "options" });
  });

  it("is null past the end of the tape, so nothing is announced", () => {
    expect(podcastNowPlaying(tape, [], 0)).toBeNull();
  });
});
