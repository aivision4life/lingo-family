import { describe, expect, it } from "vitest";
import { audioSpan, isContiguousFromOne, lengthOptions, lengthQuestionCount, pointsOf, scoreTest } from "./topikTest";

describe("isContiguousFromOne", () => {
  it("accepts a paper numbered 1..n", () => {
    expect(isContiguousFromOne([1, 2, 3, 4])).toBe(true);
  });

  it("does not care what order the numbers arrive in", () => {
    expect(isContiguousFromOne([3, 1, 2])).toBe(true);
  });

  it("rejects a hole: 'questions 1-20' must really be 1-20", () => {
    expect(isContiguousFromOne([1, 2, 4, 5])).toBe(false);
  });

  it("rejects a paper that does not start at 1", () => {
    expect(isContiguousFromOne([2, 3, 4])).toBe(false);
  });

  it("rejects an empty paper", () => {
    expect(isContiguousFromOne([])).toBe(false);
  });
});

describe("lengthQuestionCount", () => {
  it("takes the fixed lengths at face value", () => {
    expect(lengthQuestionCount(20, 50)).toBe(20);
  });

  it('"full" is whatever the paper has ready', () => {
    expect(lengthQuestionCount("full", 12)).toBe(12);
  });
});

describe("lengthOptions", () => {
  it("offers all three for a complete paper", () => {
    expect(lengthOptions(50, true).map((o) => o.available)).toEqual([true, true, true]);
  });

  it("disables the lengths a half-typed paper cannot fill, and says how many it has", () => {
    const options = lengthOptions(12, true);
    expect(options.map((o) => o.available)).toEqual([false, false, true]);
    expect(options[2]).toEqual({ length: "full", available: true, questions: 12 });
  });

  it("the middle length is 32 questions: 31 ready is one short", () => {
    expect(lengthOptions(31, true).map((o) => [o.length, o.available])).toEqual([[20, true], [32, false], ["full", true]]);
    expect(lengthOptions(32, true)[1]).toEqual({ length: 32, available: true, questions: 32 });
  });

  it("offers nothing at all when the numbering has a hole", () => {
    expect(lengthOptions(32, false).every((o) => !o.available)).toBe(true);
  });

  it("offers nothing for a paper with no ready questions", () => {
    expect(lengthOptions(0, true).every((o) => !o.available)).toBe(true);
  });
});

describe("audioSpan", () => {
  it("runs from the first clip's start to the last clip's end", () => {
    expect(
      audioSpan([
        { start_ms: 43_700, end_ms: 115_400 },
        { start_ms: 115_400, end_ms: 152_600 },
      ]),
    ).toEqual({ start_ms: 43_700, end_ms: 152_600 });
  });

  it("does not assume the clips arrive in order", () => {
    expect(
      audioSpan([
        { start_ms: 115_400, end_ms: 152_600 },
        { start_ms: 43_700, end_ms: 115_400 },
      ]),
    ).toEqual({ start_ms: 43_700, end_ms: 152_600 });
  });

  it("is null for a paper with no audio — a reading test", () => {
    expect(audioSpan([])).toBeNull();
  });
});

describe("scoreTest", () => {
  it("adds up the points of the correct answers only", () => {
    expect(
      scoreTest([
        { points: 2, is_correct: true },
        { points: 3, is_correct: false },
        { points: 2, is_correct: true },
      ]),
    ).toEqual({ correct_count: 2, score_points: 4, total_points: 7 });
  });

  it("counts an unanswered position as wrong — the tape ran past it", () => {
    expect(scoreTest([{ points: 2, is_correct: null }])).toEqual({ correct_count: 0, score_points: 0, total_points: 2 });
  });

  it("scores an empty paper as zero rather than throwing", () => {
    expect(scoreTest([])).toEqual({ correct_count: 0, score_points: 0, total_points: 0 });
  });
});

describe("pointsOf", () => {
  it("keeps a real value", () => {
    expect(pointsOf(3)).toBe(3);
  });

  it("falls back to the default rather than letting a question be worth nothing", () => {
    expect(pointsOf(null)).toBe(2);
    expect(pointsOf(0)).toBe(2);
    expect(pointsOf(undefined)).toBe(2);
  });
});
