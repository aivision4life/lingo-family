import { useCallback, useMemo, useState } from "react";
import type { TopikTestRun } from "@shared/topik";
import { mixedTimeline, stitchedPosition } from "./mixedTimeline";
import type { TapeEvent } from "./mixedTape";
import { tapeLogLine } from "./tapeLog";
import { isFinished, type TestPosition } from "./testClock";
import { useMixedTape } from "./useMixedTape";
import { useTestTape } from "./useTestTape";

/** How many log lines are kept; enough to cover a whole sitting's handovers. */
const LOG_LINES = 80;

/**
 * One tape, whichever kind of paper is being sat (M6.5).
 *
 * An original paper is one span of one file; a mixed paper is clips from many files stitched into
 * one virtual timeline (`mixedTimeline`). Everything above this line — which question is current,
 * the countdown, the park, the auto-submit — then works on `positionMs` and `endMs` without
 * knowing which kind it is, so none of those rules had to be written twice.
 */
export type SittingTape = {
  /** Where the playing head is: file milliseconds for a paper, stitched ones for a mixed test. */
  positionMs: number;
  /** The end of the paper, in the same milliseconds. */
  endMs: number;
  /** The questions, with their clips in that same space. */
  positions: TestPosition[];
  playing: boolean;
  /** True while a mixed tape sits in a clip's silence waiting for the next file to load. */
  waiting: boolean;
  finished: boolean;
  /** A mixed tape must be started by a tap, so both `<audio>` elements unlock on a real gesture. */
  needsStart: boolean;
  pauseCount: number;
  pausedMs: number;
  start: () => void;
  toggle: () => void;
  stop: () => void;
  /** The mixed tape's own log, shown behind a disclosure during the sitting. */
  log: string[];
};

export function useSittingTape(test: TopikTestRun): SittingTape {
  const mixed = test.kind === "mixed";
  const timeline = useMemo(() => mixedTimeline(test.questions), [test.questions]);
  // Both hooks always run (they must), and the unused one stays inert: `useTestTape(null)` loads
  // no file, and the mixed tape does nothing until something starts it.
  const single = useTestTape(mixed ? null : test.audio);
  const multi = useMixedTape();
  const [log, setLog] = useState<string[]>([]);
  const [started, setStarted] = useState(false);

  const note = useCallback((e: TapeEvent) => setLog((lines) => [...lines, tapeLogLine(e, new Date())].slice(-LOG_LINES)), []);
  const start = useCallback(() => {
    setStarted(true);
    void multi.start(timeline.clips, note);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- multi is rebuilt every render by design
  }, [timeline, note]);

  if (!mixed) {
    const endMs = test.audio?.end_ms ?? 0;
    return {
      positionMs: single.positionMs,
      endMs,
      positions: test.questions,
      playing: single.playing,
      waiting: false,
      finished: test.audio !== null && isFinished(single.positionMs, endMs),
      needsStart: false,
      pauseCount: single.pauseCount,
      pausedMs: single.pausedMs,
      start: () => undefined,
      toggle: single.toggle,
      stop: single.stop,
      log: [],
    };
  }

  return {
    positionMs: stitchedPosition(timeline, multi.index, multi.positionMs),
    endMs: timeline.totalMs,
    positions: timeline.positions,
    playing: multi.playing,
    waiting: multi.waiting,
    // The tape says so itself, rather than being inferred from the clock: a sitting must not
    // submit because the last clip's `timeupdate` happened to land a few milliseconds short.
    finished: multi.finished,
    needsStart: !started,
    pauseCount: multi.pauseCount,
    pausedMs: multi.pausedMs,
    start,
    toggle: () => multi.toggle(),
    stop: () => multi.stop(),
    log,
  };
}
