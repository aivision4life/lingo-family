import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMixedTape, elementSlots, STALL_SECONDS, type TapeEvent, type TapeTrack } from "./mixedTape";
import { podcastTtsRate } from "./podcastRate";
import { GAP_SILENCE_SRC } from "./tapeSilence";

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
  loop = false;
  paused = true;
  currentTime = 0;
  readyState = 0;
  playCalls = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = false;
  // Keyed by the function the caller passed, so `removeEventListener(type, fn)` takes a `once`
  // listener off by that same reference — which is what a real element does, and what the tape
  // relies on to abandon a load.
  private listeners = new Map<string, Map<() => void, () => void>>();

  addEventListener(type: string, fn: () => void, opts?: { once?: boolean }) {
    const wrapped = opts?.once
      ? () => {
          this.removeEventListener(type, fn);
          fn();
        }
      : fn;
    (this.listeners.get(type) ?? this.listeners.set(type, new Map()).get(type)!).set(fn, wrapped);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string) {
    // A real element throws away what it had loaded when a load fails (readyState back to
    // HAVE_NOTHING). Keeping 4 here made a failed file look loaded to the next attempt.
    if (type === "error") this.readyState = 0;
    for (const fn of [...(this.listeners.get(type) ?? []).values()]) fn();
  }
  /** How many listeners of `type` are still attached: a leak is a listener nobody took off. */
  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
  /** Set to make every load fail by itself, the way a 404 does. */
  failOnLoad = false;
  /** What the browser would say went wrong: 2 network, 3 decode, 4 cannot open this file. */
  error: { code: number } | null = null;
  load() {
    if (this.failOnLoad) void Promise.resolve().then(() => this.fire("error"));
  }
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

/**
 * Fake-timer playback: a real element's `currentTime` moves while it plays, and the tape now
 * watches that to spot a track that has run out of data. A test that advances the clock without
 * moving the head is testing a frozen element, not a playing one.
 */
async function playFor(el: FakeAudio, seconds: number) {
  for (let i = 0; i < seconds; i += 1) {
    el.currentTime += 1;
    await vi.advanceTimersByTimeAsync(1_000);
  }
}

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
    // Three, not two: the gap's looping silence is an element as well, and it has to be blessed
    // by the same gesture or the first gap with the screen off is the last thing heard (M8.2).
    expect(elements).toHaveLength(3);
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
      // The answer loads during the gap on the OTHER element: the gap takes no slot of its own,
      // so the options and the answer no longer meet on one `<audio>` (see `elementSlots`).
      elements[1]!.arrive();
      await vi.advanceTimersByTimeAsync(0);

      // Four seconds in, the gap is still a gap.
      await vi.advanceTimersByTimeAsync(4_000);
      expect(tape.getState().index).toBe(1);

      await vi.advanceTimersByTimeAsync(1_500);
      expect(tape.getState().index).toBe(2);
      // The gap plays on neither of the two speaking elements; its silence has one of its own.
      expect(elements).toHaveLength(3);
      expect(elements[2]!.src).toBe(GAP_SILENCE_SRC);
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
      elements[1]!.arrive();

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

  it("keeps real silence playing through the gap, and stops it when the gap ends", async () => {
    vi.useFakeTimers();
    try {
      const tape = createMixedTape([file("options.mp3"), { kind: "silence", ms: 5_000 }, file("answer.mp3")]);
      const run = tape.start();
      await vi.advanceTimersByTimeAsync(0);
      elements[0]!.arrive();
      await run;
      const gapEl = elements[2]!;
      // Unlocked and left paused: nothing is playing while the options are being read.
      expect(gapEl.paused).toBe(true);

      elements[0]!.fire("ended");
      await vi.advanceTimersByTimeAsync(0);
      elements[1]!.arrive();
      // In the gap something is playing, which is what stops the browser calling the session over
      // and throttling the timer that ends the gap.
      expect(tape.getState().index).toBe(1);
      expect(gapEl.paused).toBe(false);
      expect(gapEl.loop).toBe(true);

      // Pausing inside the gap stops the silence too: a paused podcast holds no audio open.
      tape.toggle();
      expect(gapEl.paused).toBe(true);
      tape.toggle();
      expect(gapEl.paused).toBe(false);

      await vi.advanceTimersByTimeAsync(5_100);
      expect(tape.getState().index).toBe(2);
      expect(gapEl.paused).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("notices the browser taking the sound away, and replays the piece from its start", async () => {
    const { tape } = await tapeOn([file("options.mp3"), file("answer.mp3")]);
    elements[0]!.currentTime = 6;

    // A phone call: the element is paused by the browser, not by the tape.
    elements[0]!.paused = true;
    elements[0]!.fire("pause");
    await settle();
    expect(tape.getState()).toMatchObject({ playing: false, interrupted: true, index: 0 });

    const before = elements[0]!.playCalls;
    tape.toggle();
    await settle();
    // Not carried on from six seconds in: the option that was talked over is read again whole.
    expect(elements[0]!.currentTime).toBe(0);
    expect(elements[0]!.playCalls).toBe(before + 1);
    expect(tape.getState()).toMatchObject({ playing: true, interrupted: false, index: 0 });
  });

  it("does not call the tape's own pauses an interruption", async () => {
    const { tape } = await tapeOn([file("options.mp3"), file("answer.mp3")]);
    tape.toggle();
    // A real element fires `pause` for the tape's own pause exactly as it does for a phone call.
    elements[0]!.fire("pause");
    await settle();
    expect(tape.getState()).toMatchObject({ playing: false, interrupted: false });

    elements[0]!.currentTime = 4;
    tape.toggle();
    await settle();
    // An ordinary pause carries on where it stopped; only an interruption starts the piece again.
    expect(elements[0]!.currentTime).toBe(4);
    expect(tape.getState()).toMatchObject({ playing: true, interrupted: false });
  });

  it("jumps to a later track, which is how the next question is reached", async () => {
    const { tape } = await tapeOn([file("a.mp3"), { kind: "silence", ms: 5_000 }, file("b.mp3"), file("c.mp3")]);
    const jumped = tape.jumpTo(2);
    await settle();
    elements[1]!.arrive();
    await jumped;
    await settle();
    expect(tape.getState().index).toBe(2);
    expect(tape.getState().playing).toBe(true);
  });
});

/**
 * A whole podcast question, all six tracks of it (M8.1): the shape the real thing plays, which is
 * where both of the faults below could be heard — one of them as "after the clip only one option
 * is read, then it stops".
 */
describe("a whole podcast question", () => {
  const question = (n: number): TapeTrack[] => [
    { kind: "file", audio_key: `q${n}-number.mp3` },
    { kind: "file", audio_key: `q${n}-line.mp3` },
    { kind: "clip", audio_key: `q${n}-exam.mp3`, start_ms: 0, speech_end_ms: 20_000, end_ms: 25_000 },
    { kind: "file", audio_key: `q${n}-options.mp3` },
    { kind: "silence", ms: 5_000 },
    { kind: "file", audio_key: `q${n}-answer.mp3` },
  ];

  /** Lets the tape's promise chain run to a standstill while the clock is held still. */
  async function flush() {
    for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(0);
  }

  /** Plays track `index` to its end, the way the browser would: load, then end or reach `end_ms`. */
  async function playOut(tracks: readonly TapeTrack[], index: number) {
    const slot = elementSlots(tracks)[index];
    if (slot === null || slot === undefined) {
      await vi.advanceTimersByTimeAsync(5_000); // a gap ends by itself
      return;
    }
    const el = elements[slot]!;
    el.arrive();
    await flush();
    const track = tracks[index]!;
    if (track.kind === "clip") {
      el.currentTime = track.end_ms / 1000;
      el.fire("timeupdate");
    } else el.fire("ended");
    await flush();
  }

  async function startOn(tracks: readonly TapeTrack[]) {
    const events: TapeEvent[] = [];
    const tape = createMixedTape(tracks, (e) => events.push(e));
    const started = tape.start();
    await vi.advanceTimersByTimeAsync(0);
    elements[0]!.arrive();
    await started;
    await vi.advanceTimersByTimeAsync(0);
    const played = () => events.filter((e) => e.kind === "playing").map((e) => (e.kind === "playing" ? e.index : -1));
    return { tape, events, played };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays all six tracks in order, skipping none and cutting none short", async () => {
    const tracks = question(1);
    const { tape, events, played } = await startOn(tracks);
    for (let i = 0; i < tracks.length; i += 1) await playOut(tracks, i);

    // Every track, once, in order — in particular the options (3) and then the answer (5), which
    // is what the shared element used to put at risk.
    expect(played()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(kinds(events)).not.toContain("error");
    expect(tape.getState()).toMatchObject({ finished: true, playing: false });
  });

  it("leaves no listener behind on either element", async () => {
    const tracks = question(1);
    const { tape } = await startOn(tracks);
    for (let i = 0; i < tracks.length; i += 1) await playOut(tracks, i);
    // A surviving `ended` or `timeupdate` fires again the moment the element is reused and hands
    // the tape over from a track that stopped playing long ago (the 14 November fault).
    for (const el of elements) {
      expect(el.listenerCount("ended")).toBe(0);
      expect(el.listenerCount("timeupdate")).toBe(0);
      expect(el.listenerCount("loadedmetadata")).toBe(0);
      expect(el.listenerCount("canplay")).toBe(0);
    }
    expect(tape.getState().finished).toBe(true);
  });

  it("goes to the next question when Next is pressed inside the gap", async () => {
    const tracks = [...question(1), ...question(2)];
    const { tape, played } = await startOn(tracks);
    for (let i = 0; i < 5; i += 1) await playOut(tracks, i); // up to and into the gap
    expect(tape.getState().index).toBe(4);

    const jumped = tape.jumpTo(6);
    await vi.advanceTimersByTimeAsync(0);
    elements[elementSlots(tracks)[6]!]!.arrive();
    await jumped;
    await vi.advanceTimersByTimeAsync(0);

    expect(tape.getState()).toMatchObject({ index: 6, playing: true });
    // The answer of the question that was skipped is never heard, and the gap's timer is dead: it
    // must not hand over on top of the question that is now playing.
    expect(played()).not.toContain(5);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tape.getState().index).toBe(6);
  });

  it("holds the gap while paused, then finishes the question", async () => {
    const tracks = question(1);
    const { tape, played } = await startOn(tracks);
    for (let i = 0; i < 4; i += 1) await playOut(tracks, i);
    expect(tape.getState().index).toBe(4);

    tape.toggle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tape.getState()).toMatchObject({ index: 4, playing: false });

    tape.toggle();
    await playOut(tracks, 4);
    await playOut(tracks, 5);
    expect(played()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tape.getState().finished).toBe(true);
  });

  it("carries on after a pause in the middle of a file, and still hands over at its end", async () => {
    const tracks = question(1);
    const { tape, played } = await startOn(tracks);
    // Paused on the way into the question line: its watcher comes off, and resuming must put one
    // back or the file would play to its end and the tape would sit there for ever.
    await playOut(tracks, 0);
    tape.toggle();
    expect(tape.getState().playing).toBe(false);
    tape.toggle();
    expect(tape.getState().playing).toBe(true);
    for (const i of [1, 2, 3]) await playOut(tracks, i);
    // Nothing was lost to the pause: the line, the clip and the options all played, and the tape
    // is sitting in the gap where it should be.
    expect(played()).toEqual([0, 1, 2, 3, 4]);
    expect(tape.getState().index).toBe(4);
  });

  it("does not start two tracks when Next lands while a file is still loading", async () => {
    const tracks = [...question(1), ...question(2)];
    const { tape, played } = await startOn(tracks);
    // The question line has not loaded, so the hand-over is waiting on it.
    elements[0]!.fire("ended");
    await vi.advanceTimersByTimeAsync(0);
    expect(tape.getState().waiting).toBe(true);

    const jumped = tape.jumpTo(6);
    await vi.advanceTimersByTimeAsync(0);
    elements[elementSlots(tracks)[6]!]!.arrive();
    await jumped;
    await vi.advanceTimersByTimeAsync(0);
    expect(tape.getState().index).toBe(6);

    // The abandoned load arriving late must not now start the track nobody is waiting for.
    elements[elementSlots(tracks)[1]!]!.arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(tape.getState().index).toBe(6);
    expect(played().filter((i) => i === 1)).toHaveLength(0);
  });
});

/**
 * Every listener belongs to one track and must die with it. These are the assertions that fail
 * when any single piece of that is taken away — a leak is not visible in what you hear until an
 * element is reused, which is exactly how the listening sitting broke on 14 November.
 */
describe("a track's listeners die with the track", () => {
  const file = (audio_key: string): TapeTrack => ({ kind: "file", audio_key });
  const watchers = (el: (typeof elements)[number]) => el.listenerCount("ended") + el.listenerCount("timeupdate");

  async function started(tracks: readonly TapeTrack[]) {
    const events: TapeEvent[] = [];
    const tape = createMixedTape(tracks, (e) => events.push(e));
    const run = tape.start();
    await settle();
    elements[0]!.arrive();
    await run;
    await settle();
    const played = () => events.filter((e) => e.kind === "playing").map((e) => (e.kind === "playing" ? e.index : -1));
    return { tape, events, played };
  }

  it("watches exactly one track at a time, and nothing once the tape is over", async () => {
    const { tape } = await started([file("a.mp3"), file("b.mp3")]);
    expect(watchers(elements[0]!)).toBe(2); // `ended` and `timeupdate`, for track 0 only
    expect(watchers(elements[1]!)).toBe(0);

    elements[1]!.arrive();
    await settle();
    elements[0]!.fire("ended");
    await settle();
    expect(watchers(elements[0]!)).toBe(0);
    expect(watchers(elements[1]!)).toBe(2);

    elements[1]!.fire("ended");
    await settle();
    expect(tape.getState().finished).toBe(true);
    for (const el of elements) expect(watchers(el)).toBe(0);
  });

  it("does not hand over twice when the same track reports its end again", async () => {
    const { tape, played } = await started([file("a.mp3"), file("b.mp3"), file("c.mp3")]);
    elements[1]!.arrive();
    await settle();
    elements[0]!.fire("ended");
    await settle();
    expect(tape.getState().index).toBe(1);

    // The element that played track 0 says "ended" once more. Nothing is listening any more, so
    // the tape stays where it is instead of starting track 1 a second time.
    elements[0]!.fire("ended");
    await settle();
    expect(tape.getState().index).toBe(1);
    expect(played()).toEqual([0, 1]);
  });

  it("stops watching while paused, and watches again when play resumes", async () => {
    const { tape } = await started([file("a.mp3"), file("b.mp3")]);
    tape.toggle();
    // Paused: nothing is playing, so nothing may be listening on an element that a skip could
    // hand to another track.
    expect(watchers(elements[0]!)).toBe(0);

    tape.toggle();
    expect(watchers(elements[0]!)).toBe(2);
    // And the track still hands over at its end, which is what the watcher is for.
    elements[1]!.arrive();
    await settle();
    elements[0]!.fire("ended");
    await settle();
    expect(tape.getState().index).toBe(1);
  });

  it("stops watching when the tape is stopped", async () => {
    const { tape } = await started([file("a.mp3"), file("b.mp3")]);
    tape.stop();
    expect(watchers(elements[0]!)).toBe(0);
  });

  it("stops watching when the tape is disposed", async () => {
    const { tape } = await started([file("a.mp3"), file("b.mp3")]);
    tape.dispose();
    for (const el of elements) expect(watchers(el)).toBe(0);
  });

  it("leaves nothing of the track it was told to skip", async () => {
    const { tape, played } = await started([file("a.mp3"), file("b.mp3"), file("c.mp3")]);
    const jumped = tape.jumpTo(2);
    await settle();
    elements[0]!.arrive(); // track 2 plays on element 0 again
    await jumped;
    await settle();
    expect(tape.getState().index).toBe(2);

    // Track 0's own element is the one track 2 is using now. Its old `ended` must be gone, or the
    // skipped track hands the tape over on top of the one the listener asked for.
    expect(watchers(elements[0]!)).toBe(2);
    elements[0]!.fire("ended");
    await settle();
    expect(played()).toEqual([0, 2]);
    expect(tape.getState().finished).toBe(true);

    // And the load the skip abandoned keeps nothing on its element either: its `loadedmetadata`
    // would seek that element back to the start of a track nobody is going to hear.
    expect(elements[1]!.listenerCount("loadedmetadata")).toBe(0);
    expect(elements[1]!.listenerCount("canplay")).toBe(0);
  });

  it("leaves nothing of a load that failed", async () => {
    await started([file("a.mp3"), file("b.mp3")]);
    // Track 1's load is in flight on the other element; it errors instead of arriving.
    expect(elements[1]!.listenerCount("loadedmetadata")).toBe(1);
    elements[1]!.fire("error");
    await settle();
    expect(elements[1]!.listenerCount("loadedmetadata")).toBe(0);
    expect(elements[1]!.listenerCount("canplay")).toBe(0);
    expect(elements[1]!.listenerCount("error")).toBe(0);
  });
});

/**
 * The machine voice's speed (SPEC F13). It is the browser's `playbackRate`, so nothing is
 * regenerated — but the two elements are shared between the TTS files and the exam's own
 * recording, so the speed has to be set per track and not once per element.
 */
describe("the speed the machine voice reads at", () => {
  const file = (audio_key: string): TapeTrack => ({ kind: "file", audio_key });
  const clipTrack: TapeTrack = { kind: "clip", audio_key: "exam.mp3", start_ms: 0, speech_end_ms: 20_000, end_ms: 25_000 };

  afterEach(() => podcastTtsRate.set(0.8));

  async function started(tracks: readonly TapeTrack[]) {
    const tape = createMixedTape(tracks);
    const run = tape.start();
    await settle();
    elements[0]!.arrive();
    await run;
    await settle();
    return tape;
  }

  it("reads a TTS file at the chosen speed, with the pitch kept", async () => {
    podcastTtsRate.set(0.8);
    await started([file("options.mp3")]);
    expect(elements[0]!.playbackRate).toBe(0.8);
    // Both, or the next file loaded on this element would play at full speed again.
    expect(elements[0]!.defaultPlaybackRate).toBe(0.8);
    expect(elements[0]!.preservesPitch).toBe(true);
  });

  it("plays the exam's own recording in real time on the very same element", async () => {
    podcastTtsRate.set(0.8);
    const tracks = [file("line.mp3"), clipTrack];
    // Element 0 has just read a TTS file at 0.8×; the clip is the third audio track, so it comes
    // back to element 0 and must not inherit that speed.
    const tape = await started([...tracks, file("options.mp3")]);
    expect(elements[0]!.playbackRate).toBe(0.8);
    elements[1]!.arrive();
    await settle();
    elements[0]!.fire("ended");
    await settle();
    expect(tape.getState().index).toBe(1);
    expect(elements[1]!.playbackRate).toBe(1);
    expect(elements[1]!.defaultPlaybackRate).toBe(1);
  });

  it("changes the speed of the sentence being read, not only of the next one", async () => {
    podcastTtsRate.set(1);
    await started([file("options.mp3")]);
    expect(elements[0]!.playbackRate).toBe(1);

    podcastTtsRate.set(0.8);
    expect(elements[0]!.playbackRate).toBe(0.8);
    expect(elements[0]!.defaultPlaybackRate).toBe(0.8);
  });

  it("does not touch the exam's recording when the voice speed is changed mid-clip", async () => {
    podcastTtsRate.set(1);
    await started([clipTrack]);
    podcastTtsRate.set(0.8);
    expect(elements[0]!.playbackRate).toBe(1);
  });
});

/**
 * A file that cannot be played must not stop the tape.
 *
 * Found in the browser (36회, questions 4-6): after the clip the podcast went silent for ever and
 * the four options were never read. The options file had failed to load, and the tape played it
 * anyway — `play()` on an element with no data never fires `ended`, so the hand-over that only
 * `ended` can start never came and the tape sat there. The point of these tests is that the
 * podcast carries on: a piece nobody can hear costs that piece, not the rest of the listening.
 */
describe("a file that will not load", () => {
  const file = (audio_key: string): TapeTrack => ({ kind: "file", audio_key });

  async function started(tracks: readonly TapeTrack[]) {
    const events: TapeEvent[] = [];
    const tape = createMixedTape(tracks, (e) => events.push(e));
    const run = tape.start();
    await settle();
    elements[0]!.arrive();
    await run;
    await settle();
    const played = () => events.filter((e) => e.kind === "playing").map((e) => (e.kind === "playing" ? e.index : -1));
    return { tape, events, played };
  }

  it("hands over to the next track instead of waiting for an `ended` that cannot come", async () => {
    const { tape, events, played } = await started([file("a.mp3"), file("broken.mp3"), file("c.mp3")]);
    // The broken file fails while the first track is still playing, exactly as in the browser:
    // the element reports an error and never reaches readyState 3.
    elements[1]!.fire("error");
    await settle();

    elements[0]!.fire("ended");
    await settle();
    // Its turn comes and it is asked for once more; a missing file fails the second time too.
    elements[1]!.fire("error");
    await settle();
    // The track after it loads normally, on the other element.
    elements[0]!.arrive();
    await settle();

    // It is not read — nothing can read it — but the tape has moved on to the track after it.
    expect(played()).toEqual([0, 2]);
    expect(events.some((e) => e.kind === "error")).toBe(true);
    expect(tape.getState().index).toBe(2);
    expect(tape.getState().playing).toBe(true);
  });

  it("tries the file again when its turn comes, rather than trusting a load that timed out", async () => {
    vi.useFakeTimers();
    try {
      const events: TapeEvent[] = [];
      const tape = createMixedTape([file("long-clip.mp3"), file("options.mp3")], (e) => events.push(e));
      const run = tape.start();
      await vi.advanceTimersByTimeAsync(0);
      elements[0]!.arrive();
      await run;
      await vi.advanceTimersByTimeAsync(0);

      // The second file is preloaded at the start of a track that lasts longer than the load
      // timeout — a 44-second clip, in the browser — and that load gives up while the first
      // track is still playing.
      await vi.advanceTimersByTimeAsync(21_000);
      expect(events.some((e) => e.kind === "error")).toBe(true);

      // Its turn comes, and the file is asked for again: a load that gave up 20 seconds ago is no
      // reason never to read the options.
      elements[0]!.fire("ended");
      await vi.advanceTimersByTimeAsync(0);
      elements[1]!.arrive();
      await vi.advanceTimersByTimeAsync(0);
      expect(tape.getState()).toMatchObject({ index: 1, playing: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reaches the end of the tape even if every file is broken", async () => {
    const { tape } = await started([file("a.mp3"), file("b.mp3"), file("c.mp3")]);
    // From here nothing will ever load, the retries included. The tape must still reach the end
    // rather than stop on one of them — and it must not spin for ever trying.
    for (const el of elements) el.failOnLoad = true;
    elements[1]!.fire("error"); // the preload that was already in flight
    await settle();

    elements[0]!.fire("ended");
    // Each skip is a failed retry, then the next track's failed load: several turns of the chain.
    for (let i = 0; i < 4; i += 1) await settle();
    expect(tape.getState().finished).toBe(true);
    expect(tape.getState().waiting).toBe(false);
  });
});

/**
 * The preload for the next track starts when the current one starts playing, and a podcast clip
 * can be far longer than the load timeout — 36회 question 6 is a 44-second clip against a
 * 20-second deadline. The deadline must only ever be about a load that has not arrived.
 */
describe("a long track with the next file already loaded", () => {
  const file = (audio_key: string): TapeTrack => ({ kind: "file", audio_key });
  const longClip: TapeTrack = { kind: "clip", audio_key: "exam.mp3", start_ms: 0, speech_end_ms: 40_000, end_ms: 44_000 };

  it("does not give up on a file that loaded long before the clip ended", async () => {
    vi.useFakeTimers();
    try {
      const events: TapeEvent[] = [];
      const tape = createMixedTape([longClip, file("options.mp3")], (e) => events.push(e));
      const run = tape.start();
      await vi.advanceTimersByTimeAsync(0);
      elements[0]!.arrive();
      await run;
      await vi.advanceTimersByTimeAsync(0);

      // The options arrive at once, a second into a clip that runs for forty-four.
      elements[1]!.arrive();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(events.some((e) => e.kind === "ready" && e.index === 1)).toBe(true);

      // The clip plays on, well past the twenty seconds the load was given.
      await playFor(elements[0]!, 43);
      expect(events.some((e) => e.kind === "error")).toBe(false);

      elements[0]!.currentTime = 44;
      elements[0]!.fire("timeupdate");
      await vi.advanceTimersByTimeAsync(0);

      // Straight into the options: no error, no waiting, and no second load of a file that has
      // been sitting ready on the other element for forty-three seconds.
      expect(tape.getState()).toMatchObject({ index: 1, playing: true, waiting: false });
      expect(events.some((e) => e.kind === "error")).toBe(false);
      expect(events.filter((e) => e.kind === "preloading" && e.index === 1)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * What the screen is told when a piece is lost. The owner reads this line and photographs it, so
 * it has to carry the browser's own reason rather than one word for everything.
 */
describe("saying which piece was lost, and why", () => {
  const file = (audio_key: string): TapeTrack => ({ kind: "file", audio_key });

  async function skipTheSecondTrack(code: number | null) {
    const events: TapeEvent[] = [];
    const tape = createMixedTape([file("a.mp3"), file("broken.mp3"), file("c.mp3")], (e) => events.push(e));
    // Each tape makes its own three elements (two speaking, one for the gap's silence), and this
    // helper runs more than once per test: the last three are this tape's.
    const [first, second] = elements.slice(-3) as [FakeAudio, FakeAudio, FakeAudio];
    const run = tape.start();
    await settle();
    first.arrive();
    await run;
    await settle();

    second.error = code === null ? null : { code };
    second.failOnLoad = true;
    second.fire("error");
    await settle();
    first.fire("ended");
    await settle();
    first.arrive();
    await settle();
    return events.find((e) => e.kind === "skipped");
  }

  it("names the track and the browser's reason", async () => {
    expect(await skipTheSecondTrack(4)).toEqual({ kind: "skipped", index: 1, reason: "unsupported" });
    expect(await skipTheSecondTrack(3)).toMatchObject({ reason: "decode" });
    expect(await skipTheSecondTrack(2)).toMatchObject({ reason: "network" });
  });

  it("calls it a network problem when the browser says nothing useful", async () => {
    expect(await skipTheSecondTrack(null)).toMatchObject({ kind: "skipped", index: 1, reason: "network" });
  });

  it("calls it a timeout when the load simply never arrived", async () => {
    vi.useFakeTimers();
    try {
      const events: TapeEvent[] = [];
      const tape = createMixedTape([file("a.mp3"), file("slow.mp3")], (e) => events.push(e));
      const run = tape.start();
      await vi.advanceTimersByTimeAsync(0);
      elements[0]!.arrive();
      await run;
      // Nothing ever arrives on the second element, and nothing errors either.
      await playFor(elements[0]!, 21);
      elements[0]!.fire("ended");
      await vi.advanceTimersByTimeAsync(21_000);
      expect(events.find((e) => e.kind === "skipped")).toMatchObject({ index: 1, reason: "timeout" });
      expect(tape.getState().finished).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A track that starts playing and then runs out of data (SPEC F13).
 *
 * This is the failure with no event at all: the element has part of the file, plays it, and waits
 * for the rest for ever. No `error`, no `ended`. The only sign is the playing head standing still
 * while the tape believes it is playing — the podcast read one option of four and went quiet.
 */
describe("a track that stops moving", () => {
  const file = (audio_key: string): TapeTrack => ({ kind: "file", audio_key });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The tape saying a track stood still — not the next file's own load giving up. */
  const froze = (events: readonly TapeEvent[]) => events.some((e) => e.kind === "error" && e.message.includes("đứng hình"));

  async function playing(tracks: readonly TapeTrack[]) {
    const events: TapeEvent[] = [];
    const tape = createMixedTape(tracks, (e) => events.push(e));
    const run = tape.start();
    await vi.advanceTimersByTimeAsync(0);
    elements[0]!.arrive();
    await run;
    await vi.advanceTimersByTimeAsync(0);
    return { tape, events };
  }

  it("gives a frozen track one more go from the top", async () => {
    const { tape, events } = await playing([file("options.mp3"), file("answer.mp3")]);
    await playFor(elements[0]!, 3); // three seconds of it played: one option of four

    // And then nothing moves, though nothing has errored and the element is not paused.
    await vi.advanceTimersByTimeAsync(STALL_SECONDS * 1_000);
    await vi.advanceTimersByTimeAsync(0);

    // Same track, loaded again and started again — not skipped on the first sign of trouble.
    expect(tape.getState().index).toBe(0);
    expect(events.some((e) => e.kind === "error")).toBe(true);
    expect(events.filter((e) => e.kind === "playing" && e.index === 0)).toHaveLength(2);
    expect(events.some((e) => e.kind === "skipped")).toBe(false);
  });

  it("skips it, saying it froze, when the second go freezes too", async () => {
    const { tape, events } = await playing([file("options.mp3"), file("answer.mp3")]);
    await vi.advanceTimersByTimeAsync(STALL_SECONDS * 1_000);
    await vi.advanceTimersByTimeAsync(0);
    elements[0]!.arrive();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(STALL_SECONDS * 1_000);
    await vi.advanceTimersByTimeAsync(0);
    elements[1]!.arrive();
    await vi.advanceTimersByTimeAsync(0);

    expect(events.find((e) => e.kind === "skipped")).toEqual({ kind: "skipped", index: 0, reason: "stalled" });
    expect(tape.getState().index).toBe(1);
  });

  it("leaves a track alone while it is still playing", async () => {
    const { tape, events } = await playing([file("long.mp3"), file("next.mp3")]);
    // Twenty-five seconds of real playing: far longer than the stall window, and never still.
    await playFor(elements[0]!, 25);
    expect(events.some((e) => e.kind === "skipped")).toBe(false);
    expect(froze(events)).toBe(false);
    // Played once, not started again behind its own back.
    expect(events.filter((e) => e.kind === "playing" && e.index === 0)).toHaveLength(1);
    expect(tape.getState().index).toBe(0);
  });

  it("does not call a paused tape frozen", async () => {
    const { tape, events } = await playing([file("options.mp3"), file("answer.mp3")]);
    tape.toggle();
    // Paused for a minute at the traffic lights: nothing is wrong with the file.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events.some((e) => e.kind === "skipped")).toBe(false);
    expect(froze(events)).toBe(false);

    tape.toggle();
    await playFor(elements[0]!, 3);
    expect(tape.getState()).toMatchObject({ index: 0, playing: true });
  });

  it("stops watching a track it has left", async () => {
    const { tape, events } = await playing([file("a.mp3"), file("b.mp3")]);
    elements[1]!.arrive();
    await vi.advanceTimersByTimeAsync(0);
    elements[0]!.fire("ended");
    await vi.advanceTimersByTimeAsync(0);
    expect(tape.getState().index).toBe(1);

    // Element 0 is standing still because its track is over, not because anything is wrong.
    await playFor(elements[1]!, STALL_SECONDS + 2);
    expect(events.some((e) => e.kind === "skipped")).toBe(false);
  });
});
