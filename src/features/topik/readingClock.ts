// The clock that replaces the tape in a reading mock test (M7.11).
//
// A listening paper is paced by its own recording: the tape runs, and when it ends the paper is
// over. A reading paper has nothing to play, so the countdown *is* the exam — which makes these
// few rules the whole difference between the two kinds of sitting, and worth having on their own
// where they can be tested.

/**
 * The real exam gives 70 minutes for 50 reading questions. A shorter sitting gets the same rate,
 * rounded **down** to a whole minute: 20 questions → 28:00, 30 → 42:00, 18 → 25:00 (not 25:12,
 * which reads like a glitch on a countdown).
 */
export const READING_SECONDS_PER_QUESTION = (70 * 60) / 50;

export const readingDurationMs = (questionCount: number) =>
  Math.max(0, Math.floor((questionCount * READING_SECONDS_PER_QUESTION) / 60)) * 60_000;

/** When the "time is nearly up" banner appears — and stays, rather than flashing past. */
export const READING_WARNING_MS = 3 * 60_000;
export const isInLastMinutes = (remainingMs: number) => remainingMs > 0 && remainingMs <= READING_WARNING_MS;

/**
 * Everything the clock needs to know, as plain data: when it started, how long it has spent
 * paused, and whether it is paused right now.
 *
 * `startedAt: null` means the learner has not pressed "Bắt đầu làm bài" yet. The clock deliberately
 * does not start on its own — a slow network, an image still loading or a child calling would
 * otherwise eat real exam time before the paper has even been read.
 */
export type ReadingClock = { startedAt: number | null; pausedTotalMs: number; pausedAt: number | null };

export const IDLE_CLOCK: ReadingClock = { startedAt: null, pausedTotalMs: 0, pausedAt: null };

/** Time the learner has actually spent on the paper: wall clock minus every pause. */
export function elapsedMs(clock: ReadingClock, now: number): number {
  if (clock.startedAt === null) return 0;
  // While paused, time stopped at the moment of pausing.
  const until = clock.pausedAt ?? now;
  return Math.max(0, until - clock.startedAt - clock.pausedTotalMs);
}

export const startClock = (now: number): ReadingClock => ({ startedAt: now, pausedTotalMs: 0, pausedAt: null });

/** Pause and resume, as one transition each way; the count of pauses is kept by the caller. */
export function toggleClock(clock: ReadingClock, now: number): ReadingClock {
  if (clock.startedAt === null) return clock;
  if (clock.pausedAt === null) return { ...clock, pausedAt: now };
  return { ...clock, pausedAt: null, pausedTotalMs: clock.pausedTotalMs + (now - clock.pausedAt) };
}

export const isPaused = (clock: ReadingClock) => clock.startedAt !== null && clock.pausedAt !== null;
export const isRunning = (clock: ReadingClock) => clock.startedAt !== null && clock.pausedAt === null;
