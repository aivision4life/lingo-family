import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMixedTape, type TapeEvent, type TapeTrack } from "./mixedTape";

/**
 * A stand-in for `<audio>` that only does what the tape actually depends on: a source, a
 * `readyState`, and events the test fires by hand.
 *
 * It exists for one branch in particular — the next clip not being loaded when the current one
 * ends. On a desktop with a warm cache that never happens (the real phone run handed over three
 * times with no wait at all), so the only way to prove the tape waits in the silence instead of
 * skipping a question is to hold a clip unloaded on purpose.
 */
class FakeAudio {
  src = "";
  preload = "";
  muted = false;
  paused = true;
  currentTime = 0;
  readyState = 0;
  playCalls = 0;
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, fn: () => void, opts?: { once?: boolean }) {
    const wrapped = opts?.once
      ? () => {
          this.removeEventListener(type, wrapped);
          fn();
        }
      : fn;
    // `once` wrappers are keyed by the original so a test can still remove either.
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(wrapped);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  load() {}
  removeAttribute() {
    this.src = "";
  }
  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }

  /** Metadata arrives, the file is buffered enough to play: what a loaded clip looks like. */
  arrive() {
    this.readyState = 4;
    this.fire("loadedmetadata");
    this.fire("canplay");
  }
}

const clip = (audio_key: string, lengthMs: number, silenceMs = 5_000): TapeTrack => ({
  kind: "clip",
  audio_key,
  start_ms: 0,
  speech_end_ms: lengthMs - silenceMs,
  end_ms: lengthMs,
});

let elements: FakeAudio[] = [];

beforeEach(() => {
  elements = [];
  vi.stubGlobal(
    "Audio",
    class {
      constructor() {
        const el = new FakeAudio();
        elements.push(el);
        return el as unknown as HTMLAudioElement;
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

/** Lets every already-resolved promise in the tape's chain run. */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

/** Starts a tape on two clips and gets the first one playing. */
async function tapeOnTwoClips() {
  const events: TapeEvent[] = [];
  const tape = createMixedTape([clip("a.mp3", 30_000), clip("b.mp3", 20_000)], (e) => events.push(e));
  const started = tape.start();
  await settle();
  // The unlock plays a silent sample on both elements, then the first real clip loads.
  elements[0]!.arrive();
  await started;
  await settle();
  return { tape, events, events_: () => events.map((e) => e.kind) };
}

const kinds = (events: TapeEvent[]) => events.map((e) => e.kind);

describe("mixed tape", () => {
  it("unlocks both elements inside the starting call", async () => {
    const { events } = await tapeOnTwoClips();
    expect(events[0]).toEqual({ kind: "unlocked", blocked: 0 });
    expect(elements).toHaveLength(2);
    expect(elements.every((el) => el.playCalls > 0)).toBe(true);
  });

  it("plays the first clip and loads the second while it runs", async () => {
    const { events } = await tapeOnTwoClips();
    expect(kinds(events)).toContain("playing");
    expect(elements[1]!.src).toContain("b.mp3");
  });

  it("does not hand over at the end of the speech, only at the end of the silence", async () => {
    const { tape, events } = await tapeOnTwoClips();
    elements[0]!.currentTime = 25; // speech_end_ms of a 30 s clip with 5 s of silence
    elements[0]!.fire("timeupdate");
    await settle();
    expect(kinds(events)).not.toContain("switched");
    expect(tape.getState().index).toBe(0);
  });

  it("waits in the silence when the next clip is not loaded, and skips nothing", async () => {
    const { tape, events } = await tapeOnTwoClips();
    // The second clip has arrived nowhere: readyState stays 0.
    elements[0]!.currentTime = 30;
    elements[0]!.fire("timeupdate");
    await settle();

    expect(kinds(events)).toContain("waiting");
    expect(kinds(events)).not.toContain("switched");
    expect(tape.getState().waiting).toBe(true);
    // The whole point: the tape has not moved on, and no question has been played unheard.
    expect(tape.getState().index).toBe(0);
    expect(elements[1]!.paused).toBe(true);

    // Now it loads, and the tape picks up exactly where it was waiting.
    elements[1]!.arrive();
    await settle();
    expect(kinds(events)).toContain("switched");
    expect(tape.getState()).toMatchObject({ index: 1, waiting: false, playing: true });
    expect(elements[1]!.paused).toBe(false);
  });

  it("reports how long it waited", async () => {
    const { events } = await tapeOnTwoClips();
    elements[0]!.currentTime = 30;
    elements[0]!.fire("timeupdate");
    await settle();
    elements[1]!.arrive();
    await settle();
    const switched = events.find((e) => e.kind === "switched");
    expect(switched).toMatchObject({ from: 0, to: 1 });
    if (switched?.kind === "switched") expect(switched.waitedMs).toBeGreaterThanOrEqual(0);
  });

  it("hands over without waiting when the next clip is already loaded", async () => {
    const { events } = await tapeOnTwoClips();
    elements[1]!.arrive();
    await settle();
    elements[0]!.currentTime = 30;
    elements[0]!.fire("timeupdate");
    await settle();
    expect(kinds(events)).not.toContain("waiting");
    expect(events.find((e) => e.kind === "switched")).toMatchObject({ waitedMs: 0 });
  });

  it("moves on when a clip cannot be loaded at all, rather than freezing the sitting", async () => {
    const { tape, events } = await tapeOnTwoClips();
    elements[0]!.currentTime = 30;
    elements[0]!.fire("timeupdate");
    await settle();
    elements[1]!.fire("error");
    await settle();
    expect(events.some((e) => e.kind === "error")).toBe(true);
    expect(kinds(events)).toContain("switched");
    expect(tape.getState().waiting).toBe(false);
  });

  it("ends the paper after the last clip", async () => {
    const { tape, events } = await tapeOnTwoClips();
    elements[1]!.arrive();
    await settle();
    elements[0]!.currentTime = 30;
    elements[0]!.fire("timeupdate");
    await settle();
    elements[1]!.currentTime = 20;
    elements[1]!.fire("timeupdate");
    await settle();
    expect(kinds(events)).toContain("finished");
    expect(tape.getState()).toMatchObject({ finished: true, playing: false });
  });

  it("counts every pause, because a sitting with pauses was not under exam conditions", async () => {
    const { tape } = await tapeOnTwoClips();
    tape.toggle();
    expect(tape.getState()).toMatchObject({ playing: false, pauseCount: 1 });
    tape.toggle();
    expect(tape.getState()).toMatchObject({ playing: true, pauseCount: 1 });
  });

  it("stops handing over once disposed", async () => {
    const { tape, events } = await tapeOnTwoClips();
    tape.dispose();
    elements[0]!.currentTime = 30;
    elements[0]!.fire("timeupdate");
    await settle();
    elements[1]!.arrive();
    await settle();
    expect(kinds(events)).not.toContain("switched");
  });
});

/**
 * The podcast's two new kinds of track (M8.1): a whole TTS file, whose length nobody knows until
 * it loads, and the thinking gap, which is a timer and no audio at all.
 */
describe("podcast tracks", () => {
  const file = (audio_key: string): TapeTrack => ({ kind: "file", audio_key });

  async function tapeOn(tracks: TapeTrack[]) {
    const events: TapeEvent[] = [];
    const tape = createMixedTape(tracks, (e) => events.push(e));
    const started = tape.start();
    await settle();
    elements[0]!.arrive();
    await started;
    await settle();
    return { tape, events };
  }

  it("hands over at the end of a whole file, not at a timestamp", async () => {
    const { tape, events } = await tapeOn([file("q4-line.mp3"), file("q4-options.mp3")]);
    elements[1]!.arrive();
    await settle();
    // Half way through says nothing: the file decides when it is over.
    elements[0]!.currentTime = 3;
    elements[0]!.fire("timeupdate");
    await settle();
    expect(kinds(events)).not.toContain("switched");

    elements[0]!.fire("ended");
    await settle();
    expect(tape.getState().index).toBe(1);
  });

  it("keeps the thinking gap itself, with no file to play", async () => {
    vi.useFakeTimers();
    try {
      const tape = createMixedTape([file("options.mp3"), { kind: "silence", ms: 5_000 }, file("answer.mp3")]);
      const started = tape.start();
      await vi.advanceTimersByTimeAsync(0);
      elements[0]!.arrive();
      await started;

      elements[0]!.fire("ended");
      await vi.advanceTimersByTimeAsync(0);
      expect(tape.getState().index).toBe(1);
      expect(tape.getState().playing).toBe(true);
      // The answer is loading during the gap, on the element the options have finished with.
      elements[0]!.arrive();
      await vi.advanceTimersByTimeAsync(0);

      // Four seconds in, the gap is still a gap.
      await vi.advanceTimersByTimeAsync(4_000);
      expect(tape.getState().index).toBe(1);

      await vi.advanceTimersByTimeAsync(1_500);
      expect(tape.getState().index).toBe(2);
      // The gap plays on neither element: still just the two.
      expect(elements).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the gap when the tape is paused, instead of moving on while silent", async () => {
    vi.useFakeTimers();
    try {
      const tape = createMixedTape([file("options.mp3"), { kind: "silence", ms: 5_000 }, file("answer.mp3")]);
      const started = tape.start();
      await vi.advanceTimersByTimeAsync(0);
      elements[0]!.arrive();
      await started;
      elements[0]!.fire("ended");
      await vi.advanceTimersByTimeAsync(0);
      elements[0]!.arrive();

      tape.toggle();
      expect(tape.getState().playing).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(tape.getState().index).toBe(1);

      tape.toggle();
      await vi.advanceTimersByTimeAsync(5_100);
      expect(tape.getState().index).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("jumps to a later track, which is how the next question is reached", async () => {
    const { tape } = await tapeOn([file("a.mp3"), { kind: "silence", ms: 5_000 }, file("b.mp3"), file("c.mp3")]);
    const jumped = tape.jumpTo(2);
    await settle();
    elements[0]!.arrive();
    await jumped;
    await settle();
    expect(tape.getState().index).toBe(2);
    expect(tape.getState().playing).toBe(true);
  });
});
