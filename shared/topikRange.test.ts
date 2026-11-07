import { describe, expect, it } from "vitest";
import { expandToGroups, missingNumber, rangeCount, shortcutRange, type QuestionGroup } from "./topikRange";

/** A listening paper: questions stand alone up to 20, then come in pairs on one recording. */
const pairedFrom21 = (last: number): QuestionGroup[] => {
  const groups: QuestionGroup[] = [];
  for (let n = 1; n <= Math.min(20, last); n++) groups.push([n]);
  for (let n = 21; n <= last; n += 2) groups.push(n + 1 <= last ? [n, n + 1] : [n]);
  return groups;
};

describe("rangeCount", () => {
  it("counts both ends", () => {
    expect(rangeCount({ from: 21, to: 30 })).toBe(10);
    expect(rangeCount({ from: 7, to: 7 })).toBe(1);
  });
});

describe("expandToGroups", () => {
  const groups = pairedFrom21(30);

  it("leaves a range that already holds whole groups alone", () => {
    expect(expandToGroups({ from: 21, to: 30 }, groups)).toEqual({ from: 21, to: 30, expanded: false });
    expect(expandToGroups({ from: 1, to: 20 }, groups)).toEqual({ from: 1, to: 20, expanded: false });
  });

  it("widens the end so a pair is not cut in half", () => {
    expect(expandToGroups({ from: 1, to: 21 }, groups)).toEqual({ from: 1, to: 22, expanded: true });
  });

  it("widens the start the same way", () => {
    expect(expandToGroups({ from: 22, to: 30 }, groups)).toEqual({ from: 21, to: 30, expanded: true });
  });

  it("widens both ends at once", () => {
    expect(expandToGroups({ from: 22, to: 23 }, groups)).toEqual({ from: 21, to: 24, expanded: true });
  });

  it("turns one question of a pair into the pair", () => {
    expect(expandToGroups({ from: 24, to: 24 }, groups)).toEqual({ from: 23, to: 24, expanded: true });
  });

  it("leaves a single ungrouped question alone", () => {
    expect(expandToGroups({ from: 16, to: 18 }, groups)).toEqual({ from: 16, to: 18, expanded: false });
  });

  // The rule is the data's, not the section's: the same function, given reading pairs, does the
  // same thing. This is what a reading paper with 19-20 and 23-24 will look like once typed up.
  it("works for a reading paper's own pairs", () => {
    const reading: QuestionGroup[] = [[16], [17], [18], [19, 20], [21], [22], [23, 24]];
    expect(expandToGroups({ from: 16, to: 19 }, reading)).toEqual({ from: 16, to: 20, expanded: true });
    expect(expandToGroups({ from: 20, to: 22 }, reading)).toEqual({ from: 19, to: 22, expanded: true });
    expect(expandToGroups({ from: 16, to: 18 }, reading)).toEqual({ from: 16, to: 18, expanded: false });
  });

  // A mixed sitting draws each position from a different paper, so the groups can disagree.
  it("takes the union when papers disagree about the pairing", () => {
    const disagreeing: QuestionGroup[] = [[21, 22], [21], [22, 23]];
    // 21 alone would be fine for the second paper, but the first pairs it with 22, and the third
    // then drags 23 in: the draw may land on any of them, so the safe range covers all three.
    expect(expandToGroups({ from: 21, to: 21 }, disagreeing)).toEqual({ from: 21, to: 23, expanded: true });
  });

  it("runs to a fixed point through a chain of overlapping groups", () => {
    const chain: QuestionGroup[] = [[23, 24], [24, 25], [25, 26]];
    expect(expandToGroups({ from: 23, to: 23 }, chain)).toEqual({ from: 23, to: 26, expanded: true });
  });

  it("survives no groups at all, and an empty group", () => {
    expect(expandToGroups({ from: 5, to: 9 }, [])).toEqual({ from: 5, to: 9, expanded: false });
    expect(expandToGroups({ from: 5, to: 9 }, [[]])).toEqual({ from: 5, to: 9, expanded: false });
  });
});

describe("missingNumber", () => {
  it("names the first question the bank does not have", () => {
    expect(missingNumber({ from: 7, to: 11 }, new Set([7, 8, 10, 11]))).toBe(9);
  });

  it("is null when every number is there", () => {
    expect(missingNumber({ from: 7, to: 9 }, new Set([6, 7, 8, 9, 10]))).toBeNull();
  });

  it("reports the very first one when the range starts in a hole", () => {
    expect(missingNumber({ from: 1, to: 3 }, new Set([2, 3]))).toBe(1);
  });
});

describe("shortcutRange", () => {
  it("counts from question 1, which is what the buttons mean", () => {
    expect(shortcutRange(20)).toEqual({ from: 1, to: 20 });
    expect(shortcutRange(12)).toEqual({ from: 1, to: 12 });
  });
});
