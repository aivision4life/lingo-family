import { useEffect, useRef, useState } from "react";
import { elapsedMs, IDLE_CLOCK, startClock, toggleClock, type ReadingClock } from "./readingClock";

/** How often the countdown redraws. A second is as precise as a countdown needs to be. */
const TICK_MS = 1_000;

/** Outside the component so `react-hooks/purity` does not flag the clock read itself. */
const nowMs = () => Date.now();

/**
 * The countdown of a reading sitting (M7.11): the thing that ends the paper when there is no tape
 * to end it.
 *
 * It starts only when `start()` is called — from the "Bắt đầu làm bài" button, never on mount.
 * The arithmetic lives in `readingClock.ts`, so what is left here is the timer and the state.
 */
export function useReadingClock(durationMs: number) {
  const [clock, setClock] = useState<ReadingClock>(IDLE_CLOCK);
  const [pauseCount, setPauseCount] = useState(0);
  // Re-renders once a second while running; the elapsed time is derived, never stored.
  const [, setTick] = useState(0);
  const running = clock.startedAt !== null && clock.pausedAt === null;
  const started = useRef(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = elapsedMs(clock, nowMs());
  return {
    elapsedMs: elapsed,
    remainingMs: Math.max(0, durationMs - elapsed),
    finished: clock.startedAt !== null && elapsed >= durationMs,
    running,
    started: clock.startedAt !== null,
    pauseCount,
    /** Total time spent paused, reported with the result like the listening paper's. */
    pausedMs: clock.pausedTotalMs + (clock.pausedAt === null ? 0 : nowMs() - clock.pausedAt),
    start: () => {
      if (started.current) return;
      started.current = true;
      setClock(startClock(nowMs()));
    },
    toggle: () => {
      setClock((c) => {
        if (c.startedAt !== null && c.pausedAt === null) setPauseCount((n) => n + 1);
        return toggleClock(c, nowMs());
      });
    },
    stop: () => setClock((c) => (c.startedAt !== null && c.pausedAt === null ? toggleClock(c, nowMs()) : c)),
  };
}
