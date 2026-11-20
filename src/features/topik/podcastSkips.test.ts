import { describe, expect, it } from "vitest";
import type { PodcastPlaylist } from "@shared/podcast";
import { buildPodcastTape } from "./podcastTape";
import { addSkip, describeSkip, type PodcastSkip } from "./podcastSkips";

const question = (number: number): PodcastPlaylist["questions"][number] => ({
  id: `q${number}`,
  exam: "OfficialTest-36회",
  number,
  question_line: "다음 대화를 잘 듣고 이어질 수 있는 말을 고르십시오.",
  tracks: [
    { kind: "file", audio_key: `q${number}-number.mp3` },
    { kind: "file", audio_key: `q${number}-line.mp3` },
    { kind: "clip", audio_key: "exam.mp3", start_ms: 0, speech_end_ms: 20_000, end_ms: 20_800 },
    { kind: "file", audio_key: `q${number}-options.mp3` },
    { kind: "silence", ms: 5_000 },
    { kind: "file", audio_key: `q${number}-answer.mp3` },
  ],
});

const questions = [question(4), question(5), question(6)];
const tape = buildPodcastTape({ questions });

describe("describeSkip", () => {
  it("names the question and the piece of it that was lost", () => {
    // Track 15 is the fourth piece of the third question: question 6's four options.
    expect(describeSkip(tape, questions, { index: 15, reason: "timeout" })).toEqual({
      index: 15,
      number: 6,
      step: "options",
      reason: "timeout",
    });
  });

  it("uses the paper's question number, not its place in the podcast", () => {
    expect(describeSkip(tape, questions, { index: 0, reason: "network" })!.number).toBe(4);
    expect(describeSkip(tape, questions, { index: 17, reason: "decode" })).toMatchObject({ number: 6, step: "answer" });
  });

  it("keeps the browser's own reason", () => {
    for (const reason of ["timeout", "network", "decode", "unsupported"] as const) {
      expect(describeSkip(tape, questions, { index: 3, reason })!.reason).toBe(reason);
    }
  });

  it("says nothing about a thinking gap, which has no file to fail", () => {
    expect(describeSkip(tape, questions, { index: 4, reason: "network" })).toBeNull();
  });

  it("says nothing about a track that is not on the tape", () => {
    expect(describeSkip(tape, questions, { index: -1, reason: "network" })).toBeNull();
    expect(describeSkip(tape, questions, { index: 18, reason: "network" })).toBeNull();
    expect(describeSkip(buildPodcastTape({ questions: [] }), [], { index: 0, reason: "network" })).toBeNull();
  });
});

describe("addSkip", () => {
  const skip = (index: number): PodcastSkip => ({ index, number: 4, step: "options", reason: "network" });

  it("keeps every lost piece, in the order they were lost", () => {
    expect(addSkip(addSkip([], skip(3)), skip(9)).map((s) => s.index)).toEqual([3, 9]);
  });

  it("does not say the same piece twice when its turn comes round again", () => {
    // A skip and a jump back can report the same track more than once; the line is still one line.
    expect(addSkip(addSkip([], skip(3)), skip(3)).map((s) => s.index)).toEqual([3]);
  });
});
