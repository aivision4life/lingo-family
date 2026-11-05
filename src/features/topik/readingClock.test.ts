import { describe, expect, it } from "vitest";
import { elapsedMs, IDLE_CLOCK, isInLastMinutes, isPaused, isRunning, readingDurationMs, startClock, toggleClock } from "./readingClock";

describe("readingDurationMs", () => {
  // The real paper's rate: 70 minutes for 50 questions.
  it("gives a full paper the real exam's 70 minutes", () => {
    expect(readingDurationMs(50)).toBe(70 * 60_000);
  });

  it("keeps the same rate for a shorter sitting", () => {
    expect(readingDurationMs(20)).toBe(28 * 60_000);
    expect(readingDurationMs(30)).toBe(42 * 60_000);
  });

  // 18 × 1.4 = 25.2 minutes; a countdown starting at 25:12 reads like a glitch.
  it("rounds down to a whole minute", () => {
    expect(readingDurationMs(18)).toBe(25 * 60_000);
  });

  it("is zero for an empty paper rather than negative or NaN", () => {
    expect(readingDurationMs(0)).toBe(0);
  });
});

describe("isInLastMinutes", () => {
  it("is on for the last three minutes", () => {
    expect(isInLastMinutes(3 * 60_000)).toBe(true);
    expect(isInLastMinutes(1_000)).toBe(true);
  });

  it("is off before that, and off once time is up", () => {
    expect(isInLastMinutes(3 * 60_000 + 1)).toBe(false);
    expect(isInLastMinutes(0)).toBe(false);
  });
});

describe("the clock itself", () => {
  // It must not start on its own: a slow network or a child calling would eat real exam time.
  it("counts nothing until the learner starts it", () => {
    expect(elapsedMs(IDLE_CLOCK, 10_000)).toBe(0);
    expect(isRunning(IDLE_CLOCK)).toBe(false);
  });

  it("counts from the moment it was started", () => {
    const clock = startClock(1_000);
    expect(elapsedMs(clock, 61_000)).toBe(60_000);
    expect(isRunning(clock)).toBe(true);
  });

  it("stops while paused", () => {
    const paused = toggleClock(startClock(0), 10_000);
    expect(isPaused(paused)).toBe(true);
    // Twenty seconds of wall clock later, the paper has still only seen ten.
    expect(elapsedMs(paused, 30_000)).toBe(10_000);
  });

  it("picks up where it left off when resumed", () => {
    const resumed = toggleClock(toggleClock(startClock(0), 10_000), 30_000);
    expect(isRunning(resumed)).toBe(true);
    expect(resumed.pausedTotalMs).toBe(20_000);
    expect(elapsedMs(resumed, 35_000)).toBe(15_000);
  });

  it("adds up several pauses", () => {
    let clock = startClock(0);
    clock = toggleClock(clock, 10_000); // pause 1
    clock = toggleClock(clock, 20_000); // resume
    clock = toggleClock(clock, 30_000); // pause 2
    clock = toggleClock(clock, 50_000); // resume
    expect(clock.pausedTotalMs).toBe(30_000);
    expect(elapsedMs(clock, 60_000)).toBe(30_000);
  });

  it("cannot be paused before it has started", () => {
    expect(toggleClock(IDLE_CLOCK, 5_000)).toEqual(IDLE_CLOCK);
  });
});
