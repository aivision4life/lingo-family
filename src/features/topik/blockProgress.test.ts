import { describe, expect, it } from "vitest";
import { blockProgress, blockTotals } from "./blockProgress";

describe("blockTotals", () => {
  it("adds up every block's totals", () => {
    expect(
      blockTotals([
        { count: 46, unseen: 22, mastered: 12 },
        { count: 10, unseen: 0, mastered: 10 },
        { count: 4, unseen: 4, mastered: 0 },
      ]),
    ).toEqual({ count: 60, unseen: 26, mastered: 22 });
  });

  it("is zero for an empty list (no blocks yet)", () => {
    expect(blockTotals([])).toEqual({ count: 0, unseen: 0, mastered: 0 });
  });
});

describe("blockProgress", () => {
  it("splits the bar into mastered and still-learning segments", () => {
    // 46 questions: 12 mastered, 20 answered but not mastered, 14 never answered.
    expect(blockProgress({ count: 46, unseen: 14, mastered: 12 })).toEqual({
      studied: 32,
      masteredPercent: 26,
      learningPercent: 43,
      status: "partial",
    });
  });

  // The two cases that looked identical before: both show no work outstanding, for opposite reasons.
  it("tells a finished block apart from one that was never opened", () => {
    expect(blockProgress({ count: 7, unseen: 0, mastered: 7 })).toEqual({
      studied: 7,
      masteredPercent: 100,
      learningPercent: 0,
      status: "done",
    });
    expect(blockProgress({ count: 24, unseen: 24, mastered: 0 })).toEqual({
      studied: 0,
      masteredPercent: 0,
      learningPercent: 0,
      status: "untouched",
    });
  });

  it("counts a finished-but-not-mastered block as done, with only the lighter segment", () => {
    expect(blockProgress({ count: 4, unseen: 0, mastered: 0 })).toMatchObject({ masteredPercent: 0, learningPercent: 100, status: "done" });
  });

  it("never calls an empty block done", () => {
    expect(blockProgress({ count: 0, unseen: 0, mastered: 0 })).toMatchObject({ studied: 0, status: "untouched" });
  });

  // mastered comes from topik_cards and unseen from topik_attempts; a half-written state must not
  // produce a negative-width segment.
  it("clamps the learning segment when the two sources disagree", () => {
    expect(blockProgress({ count: 10, unseen: 8, mastered: 5 })).toMatchObject({ masteredPercent: 20, learningPercent: 0 });
  });
});
