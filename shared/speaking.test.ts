import { describe, expect, it } from "vitest";
import {
  SPEAKING_RATING_EASY,
  SPEAKING_RATING_GOOD,
  SPEAKING_RATING_HARD,
  speakingRating,
  speakingRatingFromScores,
} from "./speaking";

describe("speakingRating", () => {
  // Every boundary, from both sides: these six numbers are the whole rule.
  it.each([
    [0, 1],
    [59, 1],
    [59.9, 1],
    [60, 2],
    [79, 2],
    [79.9, 2],
    [80, 3],
    [89, 3],
    [89.9, 3],
    [90, 4],
    [100, 4],
  ])("scores %s as %s", (score, grade) => {
    expect(speakingRating(score)).toBe(grade);
  });

  it("keeps the thresholds where the rule says they are", () => {
    expect([SPEAKING_RATING_HARD, SPEAKING_RATING_GOOD, SPEAKING_RATING_EASY]).toEqual([60, 80, 90]);
  });

  it("grades anything outside 0..100, and anything that is not a number, without throwing", () => {
    expect(speakingRating(1000)).toBe(4);
    expect(speakingRating(-5)).toBe(1);
    expect(speakingRating(Number.NaN)).toBe(1);
    // Infinity is not a score Azure can return: it is treated like NaN, never as a free Easy.
    expect(speakingRating(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("speakingRatingFromScores", () => {
  it("takes the best take, not the last one", () => {
    expect(speakingRatingFromScores([40, 95, 70])).toBe(4);
    expect(speakingRatingFromScores([95, 40])).toBe(4);
    expect(speakingRatingFromScores([59, 60])).toBe(2);
  });

  it("is null when no take could be scored — a card with no score is never rated", () => {
    expect(speakingRatingFromScores([])).toBeNull();
    expect(speakingRatingFromScores([Number.NaN])).toBeNull();
  });

  it("ignores an unusable score beside a usable one", () => {
    expect(speakingRatingFromScores([Number.NaN, 85])).toBe(3);
  });
});
