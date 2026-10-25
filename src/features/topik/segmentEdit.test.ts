import { describe, expect, it } from "vitest";
import type { TopikSegment } from "@shared/topik";
import { canApprove, formatTimeInput, parseTimeInput, practiceEnd, segmentProblems } from "./segmentEdit";

const seg = (over: Partial<TopikSegment> & { id: string; idx: number }): TopikSegment => ({
  start_ms: 0,
  speech_end_ms: 10_000,
  end_ms: 20_000,
  questions: [over.idx],
  ...over,
});

describe("parseTimeInput", () => {
  it("reads mm:ss.mmm, bare seconds and a decimal comma", () => {
    expect(parseTimeInput("01:42.487")).toBe(102_487);
    expect(parseTimeInput("1:42.4")).toBe(102_400);
    expect(parseTimeInput("102.487")).toBe(102_487);
    expect(parseTimeInput("102")).toBe(102_000);
    expect(parseTimeInput("1:42,487")).toBe(102_487);
  });

  it("rejects anything that is not a time", () => {
    for (const bad of ["", "   ", "abc", "1:2:3", "1:75.0", "-5"]) expect(parseTimeInput(bad)).toBeNull();
  });
});

describe("formatTimeInput", () => {
  it("round-trips with parseTimeInput", () => {
    for (const ms of [0, 999, 102_487, 3_765_054]) expect(parseTimeInput(formatTimeInput(ms))).toBe(ms);
  });
});

describe("segmentProblems", () => {
  const good = [seg({ id: "a", idx: 1, start_ms: 0, speech_end_ms: 10_000, end_ms: 20_000 }), seg({ id: "b", idx: 2, start_ms: 20_000, speech_end_ms: 30_000, end_ms: 40_000 })];

  it("is happy with clips that run back to back", () => {
    expect(segmentProblems(good, 40_000)).toEqual([]);
    expect(canApprove(good, 40_000)).toBe(true);
  });

  // These are the mistakes you cannot hear: the audio still plays, it is just the wrong audio.
  it("catches an overlap and a gap between neighbours", () => {
    const overlapping = [good[0]!, seg({ id: "b", idx: 2, start_ms: 15_000, speech_end_ms: 30_000, end_ms: 40_000 })];
    expect(segmentProblems(overlapping, 40_000)).toContainEqual({ segmentId: "a", message: "overlapsNext" });

    const gapped = [good[0]!, seg({ id: "b", idx: 2, start_ms: 25_000, speech_end_ms: 30_000, end_ms: 40_000 })];
    expect(segmentProblems(gapped, 40_000)).toContainEqual({ segmentId: "a", message: "gapToNext" });
  });

  it("catches a clip that ends before it starts, or whose speech falls outside it", () => {
    expect(segmentProblems([seg({ id: "x", idx: 1, start_ms: 30_000, speech_end_ms: 30_000, end_ms: 10_000 })], 40_000)).toContainEqual({
      segmentId: "x",
      message: "startsAfterEnd",
    });
    expect(segmentProblems([seg({ id: "x", idx: 1, start_ms: 0, speech_end_ms: 25_000, end_ms: 20_000 })], 40_000)).toContainEqual({
      segmentId: "x",
      message: "speechOutside",
    });
  });

  it("catches a clip past the end of the file and one with no question", () => {
    expect(segmentProblems([seg({ id: "x", idx: 1, end_ms: 50_000 })], 40_000)).toContainEqual({ segmentId: "x", message: "pastFile" });
    expect(segmentProblems([seg({ id: "x", idx: 1, questions: [] })], 40_000)).toContainEqual({ segmentId: "x", message: "noQuestion" });
  });

  it("never approves an exam with no clips at all", () => {
    expect(canApprove([], 40_000)).toBe(false);
  });
});

describe("practiceEnd", () => {
  // The paper leaves ~18s to answer; playing all of it would be 18 seconds of dead air, while the
  // learner answers at their own pace anyway.
  it("stops shortly after the talking, not at the exam boundary", () => {
    expect(practiceEnd({ speech_end_ms: 30_000, end_ms: 48_000 })).toBe(35_000);
  });

  it("never plays past the clip's own end", () => {
    expect(practiceEnd({ speech_end_ms: 30_000, end_ms: 31_000 })).toBe(31_000);
  });
});
