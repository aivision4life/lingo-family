// What is left of the reading sitting's own clock (M7.11) now that the server holds it (M7.13).
//
// The arithmetic moved to `shared/topikClock.ts`, because the server needs the very same rate to
// set a paper's deadline — and, since M7.31, the very same "nearly up" threshold: that moment is
// both when the banner appears and when "+5 phút" may be asked for, so one constant decides both
// on the screen and in the endpoint that grants the time.
export { readingDurationMs, READING_SECONDS_PER_QUESTION, isInLastMinutes, TIME_WARNING_MS as READING_WARNING_MS } from "@shared/topikClock";
