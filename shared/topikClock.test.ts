import { describe, expect, it } from "vitest";
import type { TopikClip } from "./topik";
import {
  elapsedMs,
  isExpired,
  isPaused,
  isStarted,
  canExtend,
  EXTENSION_STEP_MS,
  extendedClock,
  isInLastMinutes,
  PAUSED_ABANDON_MS,
  pausedClock,
  pausedTotalMs,
  readingDurationMs,
  remainingMs,
  resumedClock,
  shouldAbandonPaused,
  startedClock,
  tapeLengthMs,
  TIME_WARNING_MS,
  type TestClock,
} from "./topikClock";

const T0 = 1_700_000_000_000;
const idle: TestClock = {
  started_at: T0,
  length_ms: null,
  ends_at: null,
  paused_at: null,
  paused_ms: 0,
  pause_count: 0,
  extension_count: 0,
  extension_ms: 0,
};
const clip = (audio_key: string, start_ms: number, end_ms: number): TopikClip => ({
  audio_key,
  start_ms,
  speech_end_ms: end_ms,
  end_ms,
});

describe("readingDurationMs", () => {
  it("matches the real exam's rate for a full paper", () => {
    expect(readingDurationMs(50)).toBe(70 * 60_000);
  });

  it("rounds a shorter paper down to a whole minute", () => {
    expect(readingDurationMs(20)).toBe(28 * 60_000);
    expect(readingDurationMs(18)).toBe(25 * 60_000);
  });

  it("is zero for no questions", () => {
    expect(readingDurationMs(0)).toBe(0);
  });
});

describe("tapeLengthMs", () => {
  it("adds the clips up", () => {
    expect(tapeLengthMs([clip("a", 0, 5_000), clip("b", 1_000, 3_000)])).toBe(7_000);
  });

  it("counts a clip shared by two questions once", () => {
    const shared = clip("a", 0, 5_000);
    expect(tapeLengthMs([shared, { ...shared }, clip("b", 0, 1_000)])).toBe(6_000);
  });

  it("tells two clips of one file apart by where they start", () => {
    expect(tapeLengthMs([clip("a", 0, 1_000), clip("a", 1_000, 3_000)])).toBe(3_000);
  });

  it("is zero for a paper with no clips", () => {
    expect(tapeLengthMs([])).toBe(0);
  });
});

describe("a clock that has not started", () => {
  it("is not running and has the whole paper left", () => {
    expect(isStarted(idle)).toBe(false);
    expect(elapsedMs(idle, T0 + 60_000)).toBe(0);
    expect(isExpired(idle, T0 + 10 * 60_000)).toBe(false);
  });

  it("reports the planned length as what is left, when one is known", () => {
    expect(remainingMs({ ...idle, length_ms: 60_000 }, T0 + 5_000)).toBe(60_000);
  });
});

describe("a running clock", () => {
  const running = startedClock(idle, 10 * 60_000, T0);

  it("counts down from the moment it was started", () => {
    expect(running.ends_at).toBe(T0 + 10 * 60_000);
    expect(remainingMs(running, T0)).toBe(10 * 60_000);
    expect(remainingMs(running, T0 + 60_000)).toBe(9 * 60_000);
    expect(elapsedMs(running, T0 + 60_000)).toBe(60_000);
  });

  it("never reports negative time, and expires at the deadline", () => {
    expect(remainingMs(running, T0 + 11 * 60_000)).toBe(0);
    expect(isExpired(running, T0 + 10 * 60_000 - 1)).toBe(false);
    expect(isExpired(running, T0 + 10 * 60_000)).toBe(true);
  });

  it("puts the tape exactly where the time went", () => {
    // The whole point of the strict rule: 20 minutes away is 20 minutes of tape gone.
    const long = startedClock(idle, 30 * 60_000, T0);
    expect(elapsedMs(long, T0 + 20 * 60_000)).toBe(20 * 60_000);
  });
});

describe("pausing", () => {
  const running = startedClock(idle, 10 * 60_000, T0);

  it("freezes what is left and the tape with it", () => {
    const paused = pausedClock(running, T0 + 60_000);
    expect(isPaused(paused)).toBe(true);
    expect(remainingMs(paused, T0 + 60_000)).toBe(9 * 60_000);
    // Five minutes later, still nine minutes left.
    expect(remainingMs(paused, T0 + 6 * 60_000)).toBe(9 * 60_000);
    expect(elapsedMs(paused, T0 + 6 * 60_000)).toBe(60_000);
  });

  it("costs no exam time: resuming pushes the deadline out by the whole pause", () => {
    const paused = pausedClock(running, T0 + 60_000);
    const resumed = resumedClock(paused, T0 + 6 * 60_000);
    expect(resumed.ends_at).toBe(T0 + 15 * 60_000);
    expect(remainingMs(resumed, T0 + 6 * 60_000)).toBe(9 * 60_000);
    expect(resumed.paused_ms).toBe(5 * 60_000);
    expect(resumed.pause_count).toBe(1);
  });

  it("never expires while paused, however long", () => {
    const paused = pausedClock(running, T0 + 60_000);
    expect(isExpired(paused, T0 + 10 * 24 * 60 * 60_000)).toBe(false);
  });

  it("is abandoned once a pause has stood for a day", () => {
    const paused = pausedClock(running, T0);
    expect(shouldAbandonPaused(paused, T0 + PAUSED_ABANDON_MS - 1)).toBe(false);
    expect(shouldAbandonPaused(paused, T0 + PAUSED_ABANDON_MS)).toBe(true);
    expect(shouldAbandonPaused(running, T0 + 10 * PAUSED_ABANDON_MS)).toBe(false);
  });

  it("counts an open pause in the total", () => {
    const paused = pausedClock(running, T0 + 60_000);
    expect(pausedTotalMs(paused, T0 + 3 * 60_000)).toBe(2 * 60_000);
    expect(pausedTotalMs(running, T0 + 3 * 60_000)).toBe(0);
  });

  it("ignores a pause on a clock that never started, and a double pause or resume", () => {
    expect(pausedClock(idle, T0)).toBe(idle);
    const paused = pausedClock(running, T0 + 1_000);
    expect(pausedClock(paused, T0 + 2_000)).toBe(paused);
    expect(resumedClock(running, T0 + 2_000)).toBe(running);
  });
});

// --- extra time (M7.31) -------------------------------------------------------------------------
//
// The whole value of the clock above is that it cannot be talked round, so the one way to get more
// time out of it is tested on its edges: when it is offered, and what it does to the paper.

describe("extendedClock", () => {
  const running = startedClock(idle, 30 * 60_000, T0);
  /** Exactly inside the warning window: one second more left than the threshold is outside it. */
  const nearlyUp = T0 + 30 * 60_000 - TIME_WARNING_MS;

  it("is offered only inside the warning window, which is the same one the banner uses", () => {
    expect(isInLastMinutes(TIME_WARNING_MS)).toBe(true);
    expect(canExtend(running, nearlyUp)).toBe(true);
    expect(canExtend(running, nearlyUp - 1)).toBe(false);
  });

  it("is refused once the time is up, and on a paper that never started", () => {
    expect(canExtend(running, T0 + 30 * 60_000)).toBe(false);
    expect(canExtend(running, T0 + 60 * 60_000)).toBe(false);
    expect(canExtend(idle, T0)).toBe(false);
  });

  it("is refused while paused: the banner is not showing and no time is running out", () => {
    expect(canExtend(pausedClock(running, nearlyUp), nearlyUp)).toBe(false);
  });

  it("moves the deadline and the paper's length by the same step, so nothing rewinds", () => {
    const before = elapsedMs(running, nearlyUp);
    const extended = extendedClock(running, nearlyUp);
    expect(extended.ends_at).toBe(T0 + 30 * 60_000 + EXTENSION_STEP_MS);
    expect(extended.length_ms).toBe(30 * 60_000 + EXTENSION_STEP_MS);
    expect(remainingMs(extended, nearlyUp)).toBe(TIME_WARNING_MS + EXTENSION_STEP_MS);
    // Where the paper has got to — which is where a tape would be — is untouched.
    expect(elapsedMs(extended, nearlyUp)).toBe(before);
  });

  it("adds up over several presses, and counts them", () => {
    const once = extendedClock(running, nearlyUp);
    // Five more minutes, so the warning is over; the second press comes near the new deadline.
    const later = T0 + 30 * 60_000 + EXTENSION_STEP_MS - 60_000;
    const twice = extendedClock(once, later);
    expect(twice.extension_count).toBe(2);
    expect(twice.extension_ms).toBe(2 * EXTENSION_STEP_MS);
    expect(twice.ends_at).toBe(T0 + 30 * 60_000 + 2 * EXTENSION_STEP_MS);
  });

  it("changes nothing at all when it is not allowed", () => {
    expect(extendedClock(running, T0)).toBe(running);
    expect(extendedClock(running, T0 + 60 * 60_000)).toBe(running);
  });
});
