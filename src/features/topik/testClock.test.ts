import { describe, expect, it } from "vitest";
import type { TopikClip } from "@shared/topik";
import { formatRemaining, isFinished, isParked, positionAt, progressFraction, remainingMs, shownPosition } from "./testClock";

const clip = (start: number, speechEnd: number, end: number): TopikClip => ({
  audio_key: "topik/audio/x.mp3",
  start_ms: start,
  speech_end_ms: speechEnd,
  end_ms: end,
});

/** Three questions laid end to end, each with 18 s of answering silence after the talking. */
const paper = [
  { position: 1, clip: clip(43_700, 97_400, 115_400) },
  { position: 2, clip: clip(115_400, 134_600, 152_600) },
  { position: 3, clip: clip(152_600, 178_900, 196_900) },
];

describe("positionAt", () => {
  it("is on the question whose clip is playing", () => {
    expect(positionAt(paper, 50_000)).toBe(1);
    expect(positionAt(paper, 120_000)).toBe(2);
  });

  it("stays on a question through its answering silence", () => {
    // 100s is past the talking but inside question 1's own pause — that pause is its thinking time.
    expect(positionAt(paper, 100_000)).toBe(1);
  });

  it("moves on exactly at the clip boundary", () => {
    expect(positionAt(paper, 115_399)).toBe(1);
    expect(positionAt(paper, 115_400)).toBe(2);
  });

  it("is on the first question before the tape reaches it (the exam's own intro)", () => {
    expect(positionAt(paper, 0)).toBe(1);
  });

  it("stays on the last question once the tape has run out", () => {
    expect(positionAt(paper, 999_000)).toBe(3);
  });

  it("falls back to the first position for a paper with no audio at all", () => {
    expect(positionAt([{ position: 7, clip: null }], 0)).toBe(7);
    expect(positionAt([], 0)).toBeNull();
  });
});

describe("remainingMs / formatRemaining", () => {
  it("counts down to the end of the tape", () => {
    expect(remainingMs(100_000, 196_900)).toBe(96_900);
    expect(formatRemaining(96_900)).toBe("1:37");
  });

  it("never goes negative past the end", () => {
    expect(remainingMs(999_000, 196_900)).toBe(0);
    expect(formatRemaining(0)).toBe("0:00");
  });

  it("pads the seconds", () => {
    expect(formatRemaining(65_000)).toBe("1:05");
  });
});

describe("isFinished", () => {
  it("is true at the end of the tape", () => {
    expect(isFinished(196_900, 196_900)).toBe(true);
  });

  it("allows for timeupdate landing just short of the end", () => {
    // Events fire a few times a second; without the margin a sitting could never submit itself.
    expect(isFinished(196_800, 196_900)).toBe(true);
    expect(isFinished(196_000, 196_900)).toBe(false);
  });
});

describe("progressFraction", () => {
  it("is the share of questions answered", () => {
    expect(progressFraction(5, 20)).toBe(0.25);
  });

  it("is zero for a paper with no questions, not NaN", () => {
    expect(progressFraction(0, 0)).toBe(0);
  });
});

/**
 * M6.4 fix. The old suite tested `positionAt` — tape position to question — and nothing else,
 * because the other half of the decision ("…unless the learner went back") lived inline in the
 * component as `viewing ?? tapePosition`. That expression had no test, and it was the bug: one tap
 * on "Câu trước"/"Câu tiếp" parked the screen for the rest of the paper, so every later question
 * needed a manual tap. These tests cover the part that was never a function before.
 */
describe("shownPosition", () => {
  const answeredNone = () => false;
  const answeredAll = () => true;

  it("follows the tape when the learner has not gone anywhere", () => {
    expect(shownPosition(null, 3, answeredNone)).toBe(3);
  });

  it("holds still on a question the learner went back to and has not answered", () => {
    const park = { position: 1, tapeWhenParked: 2 };
    expect(shownPosition(park, 2, answeredNone)).toBe(1);
    // ...and keeps holding as the tape moves on, because the correction is not finished.
    expect(shownPosition(park, 5, answeredNone)).toBe(1);
  });

  it("does not yank the screen away the instant the parked question is answered", () => {
    // Still the same question on the tape as when they parked: they get to finish the thought.
    expect(shownPosition({ position: 1, tapeWhenParked: 2 }, 2, answeredAll)).toBe(1);
  });

  it("rejoins the tape at the next boundary once the parked question is answered", () => {
    expect(shownPosition({ position: 1, tapeWhenParked: 2 }, 3, answeredAll)).toBe(3);
  });

  it("rejoins when the tape catches up with the parked question", () => {
    expect(shownPosition({ position: 4, tapeWhenParked: 2 }, 4, answeredNone)).toBe(4);
  });

  it("never leaves a sitting stuck forever: an answered park always ends", () => {
    // The actual regression. Park at 1 with everything answered, let the tape run the whole paper:
    // every later position must be followed, not the parked one.
    const park = { position: 1, tapeWhenParked: 1 };
    const shown = [2, 3, 4, 5, 6].map((tape) => shownPosition(park, tape, answeredAll));
    expect(shown).toEqual([2, 3, 4, 5, 6]);
  });

  it("falls back to the parked question when the tape has no position at all", () => {
    expect(shownPosition({ position: 2, tapeWhenParked: 2 }, null, answeredAll)).toBe(2);
  });
});

describe("isParked", () => {
  it("offers the way back only while the screen is actually held away from the tape", () => {
    expect(isParked({ position: 1, tapeWhenParked: 2 }, 1, 3)).toBe(true);
    expect(isParked({ position: 1, tapeWhenParked: 2 }, 3, 3)).toBe(false);
    expect(isParked(null, 3, 3)).toBe(false);
  });
});
