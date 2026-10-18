import { describe, expect, it } from "vitest";
import { blockTotals } from "./blockTotals";

describe("blockTotals", () => {
  it("adds up every block's totals", () => {
    expect(blockTotals([{ count: 46, unseen: 22 }, { count: 10, unseen: 0 }, { count: 4, unseen: 4 }])).toEqual({ count: 60, unseen: 26 });
  });

  it("is zero for an empty list (no blocks yet)", () => {
    expect(blockTotals([])).toEqual({ count: 0, unseen: 0 });
  });
});
