import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Just enough of an <audio> element for the player, and faithful in the ways that matter here:
 * - `pause()` and `play()` do not call their listeners, they QUEUE `pause` / `play` / `playing`,
 *   which arrive later and in order (`deliver()`), exactly as a browser does;
 * - `playing` is a separate event from `play`, and with `buffering` on it does not come until
 *   `ready()` — the second or two a phone spends fetching a byte range.
 * A fake that fired everything at once could not show the bugs these tests exist for.
 * No test here renders anything.
 */
class FakeAudio {
  src = "";
  currentTime = 0;
  paused = true;
  defaultPlaybackRate = 1;
  playbackRate = 1;
  pauseCalls = 0;
  /** Makes `play()` behave as a browser that refuses to start sound without a gesture. */
  refusePlay = false;
  /** Holds `playing` back until `ready()`: play() was accepted, the data is not here yet. */
  buffering = false;
  private handlers = new Map<string, Set<() => void>>();
  private onceOf = new Map<() => void, () => void>();
  private queue: string[] = [];

  addEventListener(type: string, fn: () => void, opts?: { once?: boolean }) {
    const wrapped = opts?.once
      ? () => {
          this.removeEventListener(type, wrapped);
          fn();
        }
      : fn;
    if (opts?.once) this.onceOf.set(fn, wrapped);
    (this.handlers.get(type) ?? this.handlers.set(type, new Set()).get(type)!).add(wrapped);
  }
  removeEventListener(type: string, fn: () => void) {
    this.handlers.get(type)?.delete(this.onceOf.get(fn) ?? fn);
    this.onceOf.delete(fn);
  }

  count = (type: string) => this.handlers.get(type)?.size ?? 0;
  fire(type: string) {
    [...(this.handlers.get(type) ?? [])].forEach((fn) => fn());
  }
  /** Delivers the queued events, oldest first. */
  deliver() {
    for (const type of this.queue.splice(0)) this.fire(type);
  }
  /** The data arrived: sound starts. */
  ready() {
    this.buffering = false;
    if (!this.paused) this.queue.push("playing");
  }
  play() {
    if (this.refusePlay) return Promise.reject(new Error("NotAllowedError"));
    if (this.paused) {
      this.paused = false;
      this.queue.push("play");
      if (!this.buffering) this.queue.push("playing");
    }
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls++;
    if (!this.paused) {
      this.paused = true;
      this.queue.push("pause");
    }
  }
  /** The playing head reaches `seconds`, as the browser would report it. */
  reach(seconds: number) {
    this.currentTime = seconds;
    this.fire("timeupdate");
  }
}

let el: FakeAudio;
let player: typeof import("./player");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules(); // the player keeps one element and one state for the whole app
  // `new Audio()` in the player gets this element; a constructor that returns an object hands it back.
  vi.stubGlobal("Audio", function Audio() {
    el = new FakeAudio();
    return el;
  });
  player = await import("./player");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const EXAM = "topik/audio/exam.mp3";
const WORD = "audio/ko/voice/word.mp3";
/** Starts a clip and lets its metadata arrive, so it is really playing from its start. */
const start = (startMs: number, endMs: number, fromMs?: number) => {
  player.playSegment(EXAM, startMs, endMs, fromMs);
  el.fire("loadedmetadata");
};
const now = () => player.playerSnapshot();
const phase = () => player.playbackPhase(now());
/** Lets rejected play() promises reach their handlers. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("playSegment", () => {
  it("plays from the clip's start and stops itself at its end", () => {
    start(10_000, 20_000);
    expect(el.currentTime).toBe(10);
    el.reach(15);
    expect(el.paused).toBe(false);
    el.reach(20);
    expect(el.paused).toBe(true);
  });

  // The regression: a clip that was cut off left its watcher on the element, holding its own end.
  it("a clip cut off part way does not stop a later clip of the same file early", () => {
    start(10_000, 20_000);
    el.reach(12);
    const watchers = el.count("timeupdate");
    start(30_000, 40_000); // Replay / the next question, while the first is still playing
    const pausesSoFar = el.pauseCalls;

    el.reach(31); // past the FIRST clip's end, well inside the second
    expect(el.pauseCalls).toBe(pausesSoFar);
    expect(el.paused).toBe(false);
    expect(el.count("timeupdate")).toBe(watchers); // one clip watcher, not two

    el.reach(40);
    expect(el.paused).toBe(true);
  });

  it("stopAudio and playAudio both take the clip's watcher with them", () => {
    player.playAudio(WORD); // creates the element: what it carries now is the player's own, no clip's
    const own = el.count("timeupdate");

    start(10_000, 20_000);
    expect(el.count("timeupdate")).toBe(own + 1);
    player.stopAudio();
    expect(el.count("timeupdate")).toBe(own);

    start(10_000, 20_000);
    player.playAudio(WORD);
    el.deliver();
    expect(el.count("timeupdate")).toBe(own);
    el.reach(25); // a whole file has no stop point, and is not a clip
    expect(el.paused).toBe(false);
    expect(now()).toMatchObject({ playingKey: WORD, clip: null });
  });

  it("a clip cut off before its metadata arrived never seeks the next sound to its own start", () => {
    player.playSegment(EXAM, 10_000, 20_000); // fresh source: waiting for loadedmetadata
    player.playSegment("topik/audio/other.mp3", 30_000, 40_000);
    expect(el.count("loadedmetadata")).toBe(1);
    el.fire("loadedmetadata");
    expect(el.currentTime).toBe(30);
  });

  it("can start part way into the window without moving the window", () => {
    start(10_000, 20_000, 17_000);
    el.deliver();
    expect(el.currentTime).toBe(17);
    expect(now().clip).toEqual({ key: EXAM, startMs: 10_000, endMs: 20_000, positionMs: 17_000 });
    el.reach(20);
    expect(el.paused).toBe(true);
  });
});

describe("what the player says is playing", () => {
  it("follows the element: loading until sound starts, the clip while it runs, idle once it stops", () => {
    player.playSegment(EXAM, 10_000, 20_000);
    expect(now()).toMatchObject({ playingKey: null, loadingKey: EXAM });
    el.fire("loadedmetadata");
    el.deliver();
    expect(now()).toMatchObject({ playingKey: EXAM, loadingKey: null, clip: { startMs: 10_000, endMs: 20_000, positionMs: 10_000 } });

    el.reach(14);
    expect(now().clip?.positionMs).toBe(14_000);

    el.reach(20);
    el.deliver();
    expect(now()).toMatchObject({ playingKey: null, clip: null });
    expect(phase()).toBe("idle");
  });

  // The regression: pause() only QUEUES the old sound's `pause`. With the state set at the call
  // site, that late event cleared it, and the button offered "play" while the tape was running.
  it("is never 'idle' while a clip is replayed mid-way: loading, then playing", () => {
    start(10_000, 20_000);
    el.deliver();
    el.reach(12);

    start(10_000, 20_000); // Replay
    expect(phase()).toBe("loading");
    el.deliver(); // the first play's `pause` arrives now, then the second's `playing`
    expect(el.paused).toBe(false);
    expect(phase()).toBe("playing");
    expect(now()).toMatchObject({ playingKey: EXAM, clip: { startMs: 10_000, positionMs: 10_000 } });
  });

  it("names the new clip when one takes over from another", () => {
    start(10_000, 20_000);
    el.deliver();
    start(30_000, 40_000);
    el.deliver();
    expect(now()).toMatchObject({ playingKey: EXAM, clip: { startMs: 30_000, endMs: 40_000 } });
  });

  it("a seek while stopped is not progress", () => {
    start(10_000, 20_000);
    el.deliver();
    player.stopAudio();
    el.deliver();
    el.reach(15);
    expect(now().clip).toBeNull();
  });
});

describe("loading", () => {
  // play() accepted, `play` fired, and still no sound: the range is being fetched. That second or
  // two must not look like "nothing happened".
  it("lasts until sound really starts, not until play() was accepted", () => {
    player.playAudio(WORD);
    el.deliver(); // the earlier sound's own events are done with before the clip is asked for
    el.buffering = true;

    start(10_000, 20_000);
    el.deliver(); // `play` arrives, `playing` does not
    expect(el.paused).toBe(false);
    expect(phase()).toBe("loading");

    el.ready();
    el.deliver();
    expect(phase()).toBe("playing");
  });

  it("ends when the head moves, should a browser never send `playing`", () => {
    player.playAudio(WORD);
    el.deliver(); // the earlier sound's own events are done with before the clip is asked for
    el.buffering = true;
    start(10_000, 20_000);
    el.deliver();
    expect(phase()).toBe("loading");
    el.reach(11);
    expect(phase()).toBe("playing");
    expect(now().clip?.positionMs).toBe(11_000);
  });

  it("stopping while it loads goes back to idle", () => {
    player.playSegment(EXAM, 10_000, 20_000);
    expect(phase()).toBe("loading");
    player.stopAudio();
    expect(phase()).toBe("idle");
    vi.advanceTimersByTime(player.LOAD_TIMEOUT_MS * 2);
    expect(phase()).toBe("idle"); // and no failure is reported later for something that was stopped
  });

  it("a browser that refuses to start is idle, not loading and not an error", async () => {
    player.playSegment(EXAM, 10_000, 20_000);
    el.refusePlay = true;
    el.fire("loadedmetadata");
    await settle();
    expect(phase()).toBe("idle");
  });

  // An old request's play() is rejected (AbortError) when a newer one takes the element. That late
  // rejection must not switch off the newer request's "loading".
  it("an older request's rejected play() does not end a newer request's loading", async () => {
    player.playSegment(EXAM, 10_000, 20_000);
    el.src = `/api/media/${EXAM}`; // already the current source: the next clip begins at once
    el.refusePlay = true;
    player.playSegment(EXAM, 10_000, 20_000); // play() rejected, its handler not run yet
    el.refusePlay = false;
    el.buffering = true;
    player.playSegment(EXAM, 30_000, 40_000);
    await settle();
    expect(now().loadingKey).toBe(EXAM);
    expect(phase()).toBe("loading");
  });
});

describe("a load that fails", () => {
  it("leaves loading and says it failed, instead of looking like nothing was asked", () => {
    player.playSegment(EXAM, 10_000, 20_000);
    el.fire("error");
    expect(now()).toMatchObject({ loadingKey: null, playingKey: null, errorKey: EXAM });
    expect(phase()).toBe("error");
    expect(el.count("loadedmetadata")).toBe(0); // nothing of the failed clip is left waiting
  });

  it("is called a failure when nothing arrives in time, with no error event at all", () => {
    player.playSegment(EXAM, 10_000, 20_000);
    vi.advanceTimersByTime(player.LOAD_TIMEOUT_MS - 1);
    expect(phase()).toBe("loading");
    vi.advanceTimersByTime(1);
    expect(phase()).toBe("error");
  });

  it("is not reported for a clip that did start in time", () => {
    start(10_000, 20_000);
    el.deliver();
    vi.advanceTimersByTime(player.LOAD_TIMEOUT_MS * 2);
    expect(phase()).toBe("playing");
  });

  it("is forgotten as soon as something is asked again", () => {
    player.playSegment(EXAM, 10_000, 20_000);
    el.fire("error");
    player.playSegment(EXAM, 10_000, 20_000);
    expect(now()).toMatchObject({ errorKey: null, loadingKey: EXAM });
  });
});

describe("playbackPhase", () => {
  it("names one phase, loading first: a retry after a failure is loading, not an error", () => {
    const s = { playingKey: null, loadingKey: null, errorKey: null };
    expect(player.playbackPhase(s)).toBe("idle");
    expect(player.playbackPhase({ ...s, errorKey: "k" })).toBe("error");
    expect(player.playbackPhase({ ...s, playingKey: "k", errorKey: "k" })).toBe("playing");
    expect(player.playbackPhase({ playingKey: "k", loadingKey: "k", errorKey: "k" })).toBe("loading");
  });
});
