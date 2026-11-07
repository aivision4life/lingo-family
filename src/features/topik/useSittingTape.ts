import { useMemo, useState } from "react";
import type { TopikTestRun } from "@shared/topik";
import { mixedTimeline, stitchedPosition } from "./mixedTimeline";
import type { TapeEvent } from "./mixedTape";
import { tapeLogLine } from "./tapeLog";
import { isFinished, type TestPosition } from "./testClock";
import { useMixedTape } from "./useMixedTape";
import { useTestTape } from "./useTestTape";
import type { SittingClock } from "./useTestClock";

/** How many log lines are kept; enough to cover a whole sitting's handovers. */
const LOG_LINES = 80;

/**
 * One tape, whichever kind of paper is being sat (M6.5).
 *
 * Three kinds, one interface. An original listening paper is one span of one file; a mixed one is
 * clips from many files stitched into a virtual timeline (`mixedTimeline`); a **reading** paper has
 * nothing to play at all, so the exam clock takes the tape's place (M7.11) and `positionMs` becomes
 * time elapsed. Everything above this line — which question is current, the park, the auto-submit —
 * then works on `positionMs`/`endMs` without knowing which kind it is, so none of those rules had
 * to be written three times.
 *
 * The time itself is not this hook's any more (M7.13): the server holds it, `useTestClock` reads
 * it, and this positions the recording to match. That is what makes reopening a sitting work —
 * before, the tape *was* the clock, so a reload rewound the paper to zero and handed out the time
 * again.
 *
 * The branch is chosen by `test.section`, not by "has no audio": inferring a kind from a missing
 * field is the sort of thing that quietly becomes wrong when a listening paper's clip is late.
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
  /** Nothing has been started yet: the paper is on screen but no exam time is running. */
  needsStart: boolean;
  /**
   * The clock is running but this page has no tape playing — a sitting that was reopened. The
   * recording has to be resumed by a tap (a phone plays nothing a gesture did not ask for), and it
   * resumes at `resumeAtMs`, which is wherever the exam clock has got to.
   */
  needsResume: boolean;
  resumeAtMs: number;
  start: () => void;
  resume: () => void;
  toggle: () => void;
  stop: () => void;
  /** The mixed tape's own log, shown behind a disclosure during the sitting. */
  log: string[];
};

export function useSittingTape(test: TopikTestRun, clock: SittingClock): SittingTape {
  const reading = test.section === "reading";
  const mixed = !reading && test.kind === "mixed";
  const timeline = useMemo(() => mixedTimeline(test.questions), [test.questions]);
  // Both hooks always run (they must), and the unused one stays inert: `useTestTape(null)` loads
  // no file, and the mixed tape does nothing until something starts it.
  const single = useTestTape(mixed || reading ? null : test.audio);
  const multi = useMixedTape();
  const [log, setLog] = useState<string[]>([]);
  /** Whether the recording has been set going in *this* page view. */
  const [rolling, setRolling] = useState(false);

  const note = (e: TapeEvent) => setLog((lines) => [...lines, tapeLogLine(e, new Date())].slice(-LOG_LINES));

  // The tape is started before the clock, deliberately: `play()` only works while the tap that
  // asked for it is still the live gesture, and awaiting a network round trip first spends it. The
  // clock is told immediately afterwards and is authoritative either way.
  const playTape = (fromMs: number) => {
    setRolling(true);
    if (reading) return;
    if (mixed) void multi.start(timeline.clips, note, fromMs);
    else single.playFrom(fromMs);
  };

  const start = () => {
    playTape(0);
    void clock.start();
  };

  const resume = () => {
    playTape(clock.elapsedMs);
    if (clock.paused) clock.setPaused(false);
  };

  const toggle = () => {
    // The clock is what actually pauses the sitting; the recording just follows it.
    clock.setPaused(!clock.paused);
    if (reading) return;
    if (mixed) multi.toggle();
    else single.toggle();
  };

  const stop = () => {
    if (reading) return;
    if (mixed) multi.stop();
    else single.stop();
  };

  // Common to all three: the clock decides whether time is passing, and when the paper is over.
  const shared = {
    playing: clock.started && !clock.paused && (reading || rolling),
    needsStart: !clock.started,
    needsResume: clock.started && !rolling,
    resumeAtMs: clock.elapsedMs,
    start,
    resume,
    toggle,
    stop,
  };

  if (reading) {
    return {
      ...shared,
      // The countdown is the paper: elapsed time is the position, its length is the end.
      positionMs: clock.elapsedMs,
      endMs: clock.lengthMs,
      positions: test.questions,
      waiting: false,
      finished: clock.expired,
      // A reading paper needs no tap to come back to: there is nothing to play, so reopening one
      // drops the learner straight back into the paper with the right time left.
      needsResume: false,
      log: [],
    };
  }

  if (!mixed) {
    const endMs = test.audio?.end_ms ?? 0;
    return {
      ...shared,
      positionMs: single.positionMs,
      endMs,
      positions: test.questions,
      waiting: false,
      // Either the recording ran out or the clock did; a sitting must end on whichever comes first.
      finished: clock.expired || (rolling && test.audio !== null && isFinished(single.positionMs, endMs)),
      log: [],
    };
  }

  return {
    ...shared,
    positionMs: stitchedPosition(timeline, multi.index, multi.positionMs),
    endMs: timeline.totalMs,
    positions: timeline.positions,
    waiting: multi.waiting,
    // The tape says so itself, rather than being inferred from the clock: a sitting must not
    // submit because the last clip's `timeupdate` happened to land a few milliseconds short.
    finished: clock.expired || multi.finished,
    log,
  };
}
