import { describe, expect, it } from "vitest";
import { blockProgress, blockTotals } from "./blockProgress";

describe("blockTotals", () => {
  it("adds up every block's totals", () => {
    expect(blockTotals([{ count: 46, unseen: 22 }, { count: 10, unseen: 0 }, { count: 4, unseen: 4 }])).toEqual({ count: 60, unseen: 26 });
  });

  it("is zero for an empty list (no blocks yet)", () => {
    expect(blockTotals([])).toEqual({ count: 0, unseen: 0 });
  });
});

describe("blockProgress", () => {
  it("reports a part-finished block", () => {
    expect(blockProgress({ count: 46, unseen: 14 })).toEqual({ studied: 32, percent: 70, status: "partial" });
  });

  // The two cases that looked identical before: both show no work outstanding, for opposite reasons.
  it("tells a finished block apart from one that was never opened", () => {
    expect(blockProgress({ count: 7, unseen: 0 })).toEqual({ studied: 7, percent: 100, status: "done" });
    expect(blockProgress({ count: 24, unseen: 24 })).toEqual({ studied: 0, percent: 0, status: "untouched" });
  });

  it("never calls an empty block done", () => {
    expect(blockProgress({ count: 0, unseen: 0 })).toEqual({ studied: 0, percent: 0, status: "untouched" });
  });
});
