// The clock of a mock test (M7.13), as pure arithmetic shared by the server and the client.
//
// Until now the clock lived in the browser's memory: reloading a sitting restarted the countdown
// and sent the tape back to zero, which both broke the exam and quietly handed out extra time.
// The server now owns one mark — `ends_at` — and everything else is derived from it:
//
//     time left     = ends_at - now
//     tape position = length_ms - time left
//
// There is deliberately **no** stored "where the tape is". Two sources of truth about time drift
// apart, and the drift always favours whoever reloads. The consequence is honest and is the point:
// close the paper for twenty minutes and twenty minutes of recording have gone past, exactly as
// they would in the hall.
//
// Pausing is the escape hatch (a family flat is not an exam hall): while paused the clock stops and
// `ends_at` is pushed out by however long the pause lasted, so a pause never costs exam time.
import type { TopikClip } from "./topik";

/** The paper's own pacing: 70 minutes for 50 reading questions, the real exam's rate. */
export const READING_SECONDS_PER_QUESTION = (70 * 60) / 50;

/**
 * How long a reading paper of `questionCount` questions gets, rounded **down** to a whole minute:
 * 20 questions → 28:00, 18 → 25:00 (not 25:12, which reads like a glitch on a countdown).
 */
export const readingDurationMs = (questionCount: number) =>
  Math.max(0, Math.floor((questionCount * READING_SECONDS_PER_QUESTION) / 60)) * 60_000;

/** Two questions about one recording carry the very same clip, so it is played — and timed — once. */
export const clipKeyOf = (clip: Pick<TopikClip, "audio_key" | "start_ms">) => `${clip.audio_key}@${clip.start_ms}`;

/**
 * How long a listening tape runs: every distinct clip, back to back.
 *
 * The server needs this to set `ends_at` and the client needs it to stitch the tape, so the two
 * read it from one function — a mixed paper whose length disagreed with its own tape would either
 * cut the last clip off or leave dead air at the end.
 */
export function tapeLengthMs(clips: readonly TopikClip[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const clip of clips) {
    const key = clipKeyOf(clip);
    if (seen.has(key)) continue;
    seen.add(key);
    total += Math.max(0, clip.end_ms - clip.start_ms);
  }
  return total;
}

/**
 * The server's view of one sitting's clock.
 *
 * `ends_at === null` means the paper has not been started yet: the questions may already be drawn
 * and on screen, but no time is running. A reading paper waits for "Bắt đầu làm bài" and a
 * listening one for the tap that unlocks the tape, so neither can lose time to a slow network or an
 * image that is still loading.
 */
export type TestClock = {
  started_at: number;
  length_ms: number | null;
  ends_at: number | null;
  paused_at: number | null;
  paused_ms: number;
  pause_count: number;
  /** How much extra time was granted, and in how many presses (M7.31). */
  extension_count: number;
  extension_ms: number;
};

export const isStarted = (clock: TestClock) => clock.ends_at !== null;
export const isPaused = (clock: TestClock) => clock.paused_at !== null;

/** Milliseconds left on the paper. A paused clock is frozen at the moment it was paused. */
export function remainingMs(clock: TestClock, now: number): number {
  if (clock.ends_at === null) return clock.length_ms ?? 0;
  return Math.max(0, clock.ends_at - (clock.paused_at ?? now));
}

/**
 * How far into the paper we are — which is also where the tape has to be.
 *
 * Derived from what is left rather than from `now - started_at`, so every pause is already
 * accounted for: `ends_at` moves with them and `length_ms` never does.
 */
export function elapsedMs(clock: TestClock, now: number): number {
  if (clock.ends_at === null) return 0;
  return Math.max(0, (clock.length_ms ?? 0) - remainingMs(clock, now));
}

/** Out of time, and nobody is coming back: the server submits the paper itself. */
export const isExpired = (clock: TestClock, now: number) =>
  clock.ends_at !== null && clock.paused_at === null && now >= clock.ends_at;

/**
 * A pause nobody ever lifted. Without a cap, pausing and forgetting leaves a sitting `running` for
 * good — and a `running` sitting is one that can still be answered.
 */
export const PAUSED_ABANDON_MS = 24 * 60 * 60_000;
export const shouldAbandonPaused = (clock: TestClock, now: number) =>
  clock.paused_at !== null && now - clock.paused_at >= PAUSED_ABANDON_MS;

/** Starting the clock: the only moment `length_ms` and `ends_at` are decided. */
export const startedClock = (clock: TestClock, lengthMs: number, now: number): TestClock => ({
  ...clock,
  started_at: now,
  length_ms: lengthMs,
  ends_at: now + lengthMs,
  paused_at: null,
});

/**
 * Pausing and resuming, as one transition each way.
 *
 * Resuming pushes `ends_at` out by the whole pause, which is what makes a pause free. The total is
 * kept as well, because the result says plainly that a paused sitting was not exam conditions.
 */
export function pausedClock(clock: TestClock, now: number): TestClock {
  if (clock.ends_at === null || clock.paused_at !== null) return clock;
  return { ...clock, paused_at: now, pause_count: clock.pause_count + 1 };
}

export function resumedClock(clock: TestClock, now: number): TestClock {
  if (clock.paused_at === null) return clock;
  const held = Math.max(0, now - clock.paused_at);
  return { ...clock, paused_at: null, paused_ms: clock.paused_ms + held, ends_at: (clock.ends_at ?? now) + held };
}

/** Total time spent paused, including a pause that is still open right now. */
export const pausedTotalMs = (clock: TestClock, now: number) =>
  clock.paused_ms + (clock.paused_at === null ? 0 : Math.max(0, now - clock.paused_at));

// --- Asking for more time (M7.31) ---------------------------------------------------------------
//
// The strict clock above is the point of a mock test, so extra time is deliberately narrow: it can
// only be asked for in the last few minutes, never once the time is up, and never by the client on
// its own — the server adds it and keeps a count, so a result can say "+10 phút" instead of
// pretending the sitting was sat under exam conditions.
//
// One step moves `ends_at` **and** `length_ms` by the same amount. `ends_at` alone would make
// `elapsedMs` (= `length_ms − remaining`) jump backwards, i.e. rewind the tape; moving both leaves
// the position where it is and simply makes the paper longer, which is what being given more time
// means.

/** One press of "+5 phút". */
export const EXTENSION_STEP_MS = 5 * 60_000;

/** When the "time is nearly up" banner appears — and, with it, the button that asks for more. */
export const TIME_WARNING_MS = 3 * 60_000;
export const isInLastMinutes = (remaining: number) => remaining > 0 && remaining <= TIME_WARNING_MS;

/**
 * Whether more time may be asked for right now: the paper is running, the warning is showing, and
 * the time has not run out. The client shows the button on exactly this condition and the server
 * checks the very same one, so there is no state where the button is there but the request fails.
 */
export const canExtend = (clock: TestClock, now: number) =>
  isStarted(clock) && !isPaused(clock) && isInLastMinutes(remainingMs(clock, now));

/** One extension. Returns the clock unchanged when it is not allowed, so the caller can compare. */
export function extendedClock(clock: TestClock, now: number, stepMs = EXTENSION_STEP_MS): TestClock {
  if (!canExtend(clock, now)) return clock;
  return {
    ...clock,
    length_ms: (clock.length_ms ?? 0) + stepMs,
    ends_at: (clock.ends_at ?? now) + stepMs,
    extension_count: clock.extension_count + 1,
    extension_ms: clock.extension_ms + stepMs,
  };
}
