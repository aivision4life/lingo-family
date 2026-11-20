import { describe, expect, it } from "vitest";
import { PODCAST_GAP_MS, type PodcastQuestion } from "@shared/podcast";
import { buildPodcastTape, nextQuestionStart, podcastPositionAt, podcastQuestionStart } from "./podcastTape";

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

describe("buildPodcastTape", () => {
  const tape = buildPodcastTape({ questions: [question(4), question(5)] });

  it("lays the questions end to end", () => {
    expect(tape.tracks).toHaveLength(12);
    expect(tape.starts).toEqual([0, 6]);
  });

  it("says which question and which piece a track is", () => {
    expect(podcastPositionAt(tape, 0)).toEqual({ question: 0, step: "number" });
    expect(podcastPositionAt(tape, 2)).toEqual({ question: 0, step: "clip" });
    expect(podcastPositionAt(tape, 4)).toEqual({ question: 0, step: "gap" });
    expect(podcastPositionAt(tape, 8)).toEqual({ question: 1, step: "clip" });
  });

  it("jumps to the next question from anywhere inside this one", () => {
    expect(nextQuestionStart(tape, 0)).toBe(6);
    expect(nextQuestionStart(tape, 5)).toBe(6);
    // Nothing after the last question: the tape is over.
    expect(nextQuestionStart(tape, 11)).toBeNull();
  });

  it("has somewhere to stand on an empty tape", () => {
    const empty = buildPodcastTape({ questions: [] });
    expect(empty.tracks).toEqual([]);
    expect(podcastPositionAt(empty, 0)).toEqual({ question: 0, step: "number" });
    expect(nextQuestionStart(empty, 0)).toBeNull();
  });
});

describe("podcastQuestionStart", () => {
  const tape = buildPodcastTape({ questions: [question(4), question(5)] });

  it("is the first track of the question being played, whichever piece is on", () => {
    // F13's Previous: the answer of question 5 (track 11) replays from track 6, not track 10.
    expect(podcastQuestionStart(tape, 11)).toBe(6);
    expect(podcastQuestionStart(tape, 6)).toBe(6);
    expect(podcastQuestionStart(tape, 4)).toBe(0);
  });
});
