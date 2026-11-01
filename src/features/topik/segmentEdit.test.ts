import { describe, expect, it } from "vitest";
import type { TopikSegment } from "@shared/topik";
import {
  canApprove,
  clipProgress,
  formatDuration,
  formatTimeInput,
  headPreview,
  medianOf,
  metricsOf,
  parseTimeInput,
  practiceEnd,
  segmentProblems,
  segmentWarnings,
  tailPreview,
} from "./segmentEdit";

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

  it("catches a clip past the end of the file", () => {
    expect(segmentProblems([seg({ id: "x", idx: 1, end_ms: 50_000 })], 40_000)).toContainEqual({ segmentId: "x", message: "pastFile" });
    // A clip with no question is a warning, not a problem: see the dedicated test below.
    expect(segmentProblems([seg({ id: "x", idx: 1, questions: [] })], 40_000)).toEqual([]);
  });

  it("never approves an exam with no clips at all", () => {
    expect(canApprove([], 40_000)).toBe(false);
  });

  it("approves a paper whose later clips have no question yet", () => {
    // The real case: questions are typed up to number 12 while ffmpeg found all 36 clips. Approving
    // says the timestamps are right, not that the paper is finished, so those 12 can be practised.
    const covered = seg({ id: "a", idx: 1, start_ms: 0, speech_end_ms: 10_000, end_ms: 20_000, questions: [1] });
    const empty = seg({ id: "b", idx: 2, start_ms: 20_000, speech_end_ms: 30_000, end_ms: 40_000, questions: [] });
    expect(segmentProblems([covered, empty], 40_000)).toEqual([]);
    expect(canApprove([covered, empty], 40_000)).toBe(true);
    expect(segmentWarnings([covered, empty])).toContainEqual({ segmentId: "b", code: "noQuestion" });
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

describe("formatDuration", () => {
  it("shows m:ss.s", () => {
    expect(formatDuration(0)).toBe("0:00.0");
    expect(formatDuration(1_500)).toBe("0:01.5");
    expect(formatDuration(102_487)).toBe("1:42.5");
    expect(formatDuration(600_000)).toBe("10:00.0");
  });

  it("rounds to the shown decimal instead of truncating", () => {
    expect(formatDuration(1_960)).toBe("0:02.0");
    expect(formatDuration(59_960)).toBe("1:00.0");
  });

  it("never shows a negative time", () => {
    expect(formatDuration(-500)).toBe("0:00.0");
  });
});

describe("metricsOf", () => {
  it("derives the clip length and the answering pause", () => {
    expect(metricsOf({ start_ms: 10_000, speech_end_ms: 60_000, end_ms: 78_000 })).toEqual({ lengthMs: 68_000, pauseMs: 18_000 });
  });

  it("clamps instead of reporting a negative length when the boundaries are broken", () => {
    expect(metricsOf({ start_ms: 90_000, speech_end_ms: 95_000, end_ms: 80_000 })).toEqual({ lengthMs: 0, pauseMs: 0 });
  });
});

describe("medianOf", () => {
  it("takes the middle of an odd number of values", () => {
    expect(medianOf([30, 10, 20])).toBe(20);
  });

  it("averages the two middle values of an even number", () => {
    expect(medianOf([10, 20, 30, 40])).toBe(25);
  });

  it("is not dragged by one huge outlier, unlike a mean", () => {
    expect(medianOf([10, 11, 12, 1000])).toBe(11.5);
  });

  it("has no median for nothing", () => {
    expect(medianOf([])).toBe(0);
  });
});

describe("segmentWarnings", () => {
  /** A paper of `count` clips, each 60 s of talking plus an 18 s pause, laid end to end. */
  const paper = (count: number, over: Record<number, Partial<TopikSegment>> = {}) =>
    Array.from({ length: count }, (_, i) => ({
      ...seg({
        id: `s${i + 1}`,
        idx: i + 1,
        start_ms: i * 78_000,
        speech_end_ms: i * 78_000 + 60_000,
        end_ms: i * 78_000 + 78_000,
      }),
      ...over[i + 1],
    }));

  it("says nothing about a well-cut paper", () => {
    expect(segmentWarnings(paper(5))).toEqual([]);
  });

  it("flags a pause under 3 seconds — no time to choose an answer", () => {
    const warnings = segmentWarnings(paper(5, { 3: { speech_end_ms: 2 * 78_000 + 76_000 } }));
    expect(warnings).toEqual([{ segmentId: "s3", code: "shortPause" }]);
  });

  it("accepts exactly 3 seconds of pause", () => {
    expect(segmentWarnings(paper(4, { 2: { speech_end_ms: 78_000 + 75_000 } }))).toEqual([]);
  });

  it("flags a clip far shorter than its neighbours", () => {
    const warnings = segmentWarnings(paper(5, { 2: { end_ms: 78_000 + 20_000, speech_end_ms: 78_000 + 2_000 } }));
    expect(warnings).toContainEqual({ segmentId: "s2", code: "shortClip" });
  });

  it("judges a clip against its neighbours, not the whole paper", () => {
    // The real 35회 shape: 20 short questions, then 15 dialogues three times as long. A single
    // median lands between the groups, which flagged a normal short question and let a half-split
    // lecture clip through.
    const short = Array.from({ length: 20 }, (_, i) => seg({ id: `a${i}`, idx: i + 1, start_ms: 0, speech_end_ms: 40_000, end_ms: 58_000 }));
    const long = Array.from({ length: 15 }, (_, i) => seg({ id: `b${i}`, idx: 21 + i, start_ms: 0, speech_end_ms: 170_000, end_ms: 188_000 }));
    // The same 70-second clip: ordinary among the short questions, half a question among the lectures.
    short[9] = seg({ id: "shortSection", idx: 10, start_ms: 0, speech_end_ms: 52_000, end_ms: 70_000 });
    long[7] = seg({ id: "longSection", idx: 28, start_ms: 0, speech_end_ms: 52_000, end_ms: 70_000 });

    const codes = segmentWarnings([...short, ...long]);
    expect(codes.some((w) => w.segmentId === "shortSection")).toBe(false);
    expect(codes).toContainEqual({ segmentId: "longSection", code: "shortClip" });
  });

  it("uses its own code when the short clip is the last one (likely the closing announcement)", () => {
    const warnings = segmentWarnings(paper(5, { 5: { end_ms: 4 * 78_000 + 12_000, speech_end_ms: 4 * 78_000 + 8_000 } }));
    expect(warnings).toContainEqual({ segmentId: "s5", code: "shortLastClip" });
    expect(warnings.some((w) => w.code === "shortClip")).toBe(false);
  });

  it("does not judge length when there are too few clips for a median to mean anything", () => {
    const two = paper(2, { 2: { end_ms: 78_000 + 5_000, speech_end_ms: 78_000 + 4_000 } });
    expect(segmentWarnings(two).every((w) => w.code === "shortPause")).toBe(true);
  });

  it("reads clips in idx order, not the order they arrive in", () => {
    const reversed = [...paper(5, { 5: { end_ms: 4 * 78_000 + 12_000, speech_end_ms: 4 * 78_000 + 8_000 } })].reverse();
    expect(segmentWarnings(reversed)).toContainEqual({ segmentId: "s5", code: "shortLastClip" });
  });
});

describe("headPreview / tailPreview", () => {
  const s = seg({ id: "s1", idx: 1, start_ms: 10_000, speech_end_ms: 70_000, end_ms: 88_000 });

  it("plays the first 5 seconds from the clip's start", () => {
    expect(headPreview(s)).toEqual({ from: 10_000, to: 15_000 });
  });

  it("never runs past the end of a very short clip", () => {
    expect(headPreview({ start_ms: 10_000, end_ms: 12_000 })).toEqual({ from: 10_000, to: 12_000 });
  });

  it("ends the tail at the end of the talking, not of the clip", () => {
    // The clip's own last seconds are the paper's designed silence and would prove nothing.
    expect(tailPreview(s)).toEqual({ from: 60_000, to: 70_000 });
  });

  it("never starts the tail before the clip does", () => {
    expect(tailPreview({ start_ms: 10_000, speech_end_ms: 14_000 })).toEqual({ from: 10_000, to: 14_000 });
  });
});

describe("clipProgress", () => {
  it("runs from 0 to 1 across the clip", () => {
    expect(clipProgress(10_000, 10_000, 20_000)).toBe(0);
    expect(clipProgress(15_000, 10_000, 20_000)).toBe(0.5);
    expect(clipProgress(20_000, 10_000, 20_000)).toBe(1);
  });

  it("clamps a position outside the clip", () => {
    expect(clipProgress(5_000, 10_000, 20_000)).toBe(0);
    expect(clipProgress(99_000, 10_000, 20_000)).toBe(1);
  });

  it("does not divide by zero on a broken clip", () => {
    expect(clipProgress(10_000, 20_000, 20_000)).toBe(0);
  });
});
