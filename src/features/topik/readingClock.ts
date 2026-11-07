// What is left of the reading sitting's own clock (M7.11) now that the server holds it (M7.13).
//
// The arithmetic moved to `shared/topikClock.ts`, because the server needs the very same rate to
// set a paper's deadline. What stays here is the one thing only the screen cares about: when to
// warn that the time is nearly up.
export { readingDurationMs, READING_SECONDS_PER_QUESTION } from "@shared/topikClock";

/** When the "time is nearly up" banner appears — and stays, rather than flashing past. */
export const READING_WARNING_MS = 3 * 60_000;
export const isInLastMinutes = (remainingMs: number) => remainingMs > 0 && remainingMs <= READING_WARNING_MS;
