import { describe, expect, it } from "vitest";
import { sittingHeader } from "./sittingHeader";

describe("sittingHeader", () => {
  it("reads a paper sat from the start as position over count", () => {
    expect(sittingHeader({ from: 7, to: 7 }, { from: 1, to: 20 }, 20)).toEqual({ kind: "single", number: 7, total: 20 });
  });

  it("names the range when the sitting does not start at question 1", () => {
    // What used to read "Câu 21 / 10".
    expect(sittingHeader({ from: 21, to: 21 }, { from: 21, to: 30 }, 10)).toEqual({
      kind: "singleInRange",
      number: 21,
      from: 21,
      to: 30,
    });
  });

  it("keeps a pair together in both forms", () => {
    expect(sittingHeader({ from: 21, to: 22 }, { from: 1, to: 30 }, 30)).toEqual({ kind: "pair", first: 21, last: 22, total: 30 });
    expect(sittingHeader({ from: 23, to: 24 }, { from: 21, to: 30 }, 10)).toEqual({
      kind: "pairInRange",
      first: 23,
      last: 24,
      from: 21,
      to: 30,
    });
  });

  it("falls back to the count for a sitting from before ranges were stored", () => {
    expect(sittingHeader({ from: 3, to: 3 }, { from: null, to: null }, 18)).toEqual({ kind: "single", number: 3, total: 18 });
  });
});
