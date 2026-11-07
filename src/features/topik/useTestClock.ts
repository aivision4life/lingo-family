import { useEffect, useState } from "react";
import type { TopikTestClockView, TopikTestRun } from "@shared/topik";
import { elapsedMs, isPaused, isStarted, remainingMs, type TestClock } from "@shared/topikClock";
import { usePauseTopikTest, useStartTopikTest } from "./api";

/** How often the countdown redraws. A second is as precise as a countdown needs to be. */
const TICK_MS = 1_000;

/** Outside the component so `react-hooks/purity` does not flag the clock read itself. */
const nowMs = () => Date.now();

const clockOf = (view: TopikTestClockView | TopikTestRun): TestClock => ({
  started_at: view.started_at,
  length_ms: view.length_ms,
  ends_at: view.ends_at,
  paused_at: view.paused_at,
  paused_ms: view.paused_ms,
  pause_count: view.pause_count,
});

export type SittingClock = {
  remainingMs: number;
  /** How far into the paper we are, which is where the tape has to be. */
  elapsedMs: number;
  lengthMs: number;
  started: boolean;
  paused: boolean;
  /** The time has run out. The screen submits; the server would have done it anyway. */
  expired: boolean;
  pauseCount: number;
  pausedMs: number;
  /** Starts the clock on the server. Safe to call twice; the second call changes nothing. */
  start: () => Promise<void>;
  setPaused: (paused: boolean) => void;
};

/**
 * One sitting's clock, as the server keeps it (M7.13).
 *
 * The browser used to own this, and reloading a paper therefore restarted the countdown and sent
 * the tape back to the beginning — a reload was worth extra time. Now the server holds `ends_at`,
 * this reads it, and the only local work is ticking once a second so the digits move.
 *
 * The device's own clock is not trusted either: `server_now` arrives with the sitting, and the
 * difference against `Date.now()` is applied to every reading, so a phone set to the wrong time
 * still counts down the right number of minutes.
 */
export function useTestClock(test: TopikTestRun, profileId: string): SittingClock {
  const [clock, setClock] = useState<TestClock>(() => clockOf(test));
  const [, setTick] = useState(0);
  const startMutation = useStartTopikTest();
  const pauseMutation = usePauseTopikTest();
  // How far the device's clock is from the server's, measured once when the screen opened: the
  // sitting arrived stamped with `server_now`, and this is what `Date.now()` said at that moment.
  // Kept from the first render on purpose — a later refetch would only re-measure the same offset.
  const [skew] = useState(() => test.server_now - nowMs());

  const running = clock.ends_at !== null && clock.paused_at === null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const now = nowMs() + skew;
  const left = remainingMs(clock, now);

  const start = async () => {
    const view = await startMutation.mutateAsync({ testId: test.id, profile_id: profileId });
    setClock(clockOf(view));
  };

  const setPaused = (paused: boolean) => {
    // Optimistic, so the digits stop the moment the button is pressed; the server's answer is what
    // is kept, since its `ends_at` is the one that decides.
    setClock((c) => (paused ? { ...c, paused_at: nowMs() + skew, pause_count: c.pause_count + 1 } : c));
    pauseMutation.mutate({ testId: test.id, profile_id: profileId, paused }, { onSuccess: (view) => setClock(clockOf(view)) });
  };

  return {
    remainingMs: left,
    elapsedMs: elapsedMs(clock, now),
    lengthMs: clock.length_ms ?? 0,
    started: isStarted(clock),
    paused: isPaused(clock),
    expired: isStarted(clock) && !isPaused(clock) && left <= 0,
    pauseCount: clock.pause_count,
    pausedMs: clock.paused_ms,
    start,
    setPaused,
  };
}
