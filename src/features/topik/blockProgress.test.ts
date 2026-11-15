import { describe, expect, it } from "vitest";
import { blockProgress, blockTotals } from "./blockProgress";

const total = (
  count: number,
  unseen: number,
  mastered: number,
  due = 0,
  later = 0,
  next_due_at: number | null = null,
  reserved_for_tests = 0,
) => ({
  count,
  unseen,
  mastered,
  due,
  later,
  next_due_at,
  reserved_for_tests,
});

describe("blockTotals", () => {
  it("adds up every block's totals", () => {
    expect(blockTotals([total(46, 22, 12), total(10, 0, 10), total(4, 4, 0)])).toEqual(total(60, 26, 22));
  });

  it("adds up the waiting counts too", () => {
    expect(blockTotals([total(6, 0, 1, 0, 5, 1_000), total(5, 5, 0)])).toEqual(total(11, 5, 1, 0, 5, 1_000));
  });

  it("reports the soonest next due time across blocks, ignoring blocks with none", () => {
    expect(blockTotals([total(3, 0, 0, 0, 3, 9_000), total(3, 0, 0, 0, 3, 4_000), total(2, 2, 0)]).next_due_at).toBe(4_000);
  });

  it("has no next due time when nothing is waiting", () => {
    expect(blockTotals([total(3, 3, 0), total(2, 2, 0)]).next_due_at).toBeNull();
  });

  it("is zero for an empty list (no blocks yet)", () => {
    expect(blockTotals([])).toEqual(total(0, 0, 0));
  });

  // The total row says how much of the whole section a mock test is holding (M7.27), so the number
  // has to add up across blocks like every other one.
  it("adds up what is kept for a mock test", () => {
    expect(blockTotals([total(6, 4, 0, 0, 0, null, 4), total(5, 5, 0, 0, 0, null, 5)])).toEqual(total(11, 9, 0, 0, 0, null, 9));
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

  // "Done" has to mean learnt, not merely opened: a block answered end to end but remembered
  // nowhere is still work left, and labelling it "Đã xong" told the opposite story.
  it("is only done once every question is mastered, not once every question was answered", () => {
    expect(blockProgress({ count: 7, unseen: 0, mastered: 7 }).status).toBe("done");
    expect(blockProgress({ count: 7, unseen: 0, mastered: 0 })).toMatchObject({ masteredPercent: 0, learningPercent: 100, status: "partial" });
    expect(blockProgress({ count: 7, unseen: 0, mastered: 6 }).status).toBe("partial");
  });

  it("tells a part-done block apart from one that was never opened", () => {
    expect(blockProgress({ count: 24, unseen: 24, mastered: 0 })).toEqual({
      studied: 0,
      masteredPercent: 0,
      learningPercent: 0,
      status: "untouched",
    });
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
