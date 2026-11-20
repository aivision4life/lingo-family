// The tape: clips from several different mp3s played one after another as if they were one
// recording (M6.5, the mixed mock test), and since M8.1 whole TTS files and silent gaps too, which
// is what a TOPIK listening podcast is made of (SPEC F13).
//
// Written as a controller outside React, like `src/features/audio/player.ts`, rather than as a
// hook holding elements in refs — two `<audio>` elements, their buffering and their handover are
// an external system, and React's rules rightly refuse to let render touch them.
//
// Three rules decide everything here:
//
//  - **The switch happens at `end_ms`**, the end of the paper's own answering silence, never at
//    `speech_end_ms`. A clip's silence is part of its question, and the change of file must never
//    land on speech.
//  - **If the next clip is not ready, the tape waits in that silence** instead of skipping ahead.
//    A few extra quiet seconds cost nothing; a question nobody heard costs the sitting.
//  - **Both elements are unlocked inside the starting gesture.** A phone blocks `play()` on an
//    element no person ever started, and the second element is exactly that. This is the one risk
//    in the feature that no test can catch, so `start()` must be called straight from the tap.
//
// One tape, three kinds of track (M8.1). A podcast is the same two alternating elements with a
// different playlist — F13 says so in as many words — so rather than a second player this one
// learned two more kinds of track:
//
//  - `clip`: a slice of an exam's mp3, handed over at `end_ms`, exactly as before.
//  - `file`: a whole TTS mp3 whose length nobody knows until it loads, so it hands over on the
//    element's own `ended` event rather than at a timestamp.
//  - `silence`: the thinking gap, kept by a timer and no file at all — a gap made of audio would
//    have to be regenerated the day its length changes (M8.3 makes it adjustable).
import type { TopikClip } from "@shared/topik";
import { mediaUrl } from "@/features/audio/player";
import { applyRate } from "@/features/audio/rateSetting";
import { positionOnTimeline } from "./mixedTimeline";
import { podcastTtsRate, rateForTrack } from "./podcastRate";
import { elementSlots, type TapeTrack } from "./tapeTracks";

export { clipTracks, elementSlots, type TapeTrack } from "./tapeTracks";

/**
 * Why a file could not be played, in the words the browser gives.
 *
 * Carried out of the tape rather than written into a message here, because the person who needs
 * it is holding the phone: the podcast screen shows the piece that was lost and this reason, and
 * a photograph of that line is the whole bug report.
 */
export type TapeFailure = "timeout" | "network" | "decode" | "unsupported";

/** `MediaError.code` as a reason; anything unknown reads as a network problem. */
export const failureFromMediaError = (code: number | undefined): TapeFailure =>
  code === 3 ? "decode" : code === 4 ? "unsupported" : "network";

export type TapeEvent =
  | { kind: "unlocked"; blocked: number }
  | { kind: "skipped"; index: number; reason: TapeFailure }
  | { kind: "preloading"; index: number; src: string }
  | { kind: "ready"; index: number }
  | { kind: "playing"; index: number; src: string }
  | { kind: "waiting"; index: number }
  | { kind: "switched"; from: number; to: number; waitedMs: number }
  | { kind: "finished" }
  | { kind: "error"; message: string };

export type TapeState = {
  index: number;
  /** Milliseconds into the current track, counted from its own start. */
  positionMs: number;
  playing: boolean;
  /** True while the tape is sitting in a clip's silence waiting for the next file. */
  waiting: boolean;
  pauseCount: number;
  pausedMs: number;
  finished: boolean;
};

/** `HAVE_FUTURE_DATA`: enough buffered to start without stalling immediately. */
const READY_ENOUGH = 3;

/**
 * 0.05 s of real silence, used only to unlock the elements.
 *
 * Unlocking has to call `play()` while the tap is still live, but `play()` on an element with **no
 * source at all never settles** — Chrome keeps the promise pending waiting for a source that never
 * comes, and the whole tape hangs before its first event. Giving each element something tiny and
 * instantly decodable to play means the promise resolves immediately and the element is blessed
 * for the rest of the session.
 */
const SILENCE = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

/** A load that never finishes must not hang the sitting; after this the clip is reported failed. */
const LOAD_TIMEOUT_MS = 20_000;

export type MixedTape = ReturnType<typeof createMixedTape>;

export function createMixedTape(tracks: readonly TapeTrack[], onEvent?: (e: TapeEvent) => void) {
  const els = [new Audio(), new Audio()];
  for (const el of els) el.preload = "auto";
  /** Track → whether its file has data to play. A failed load is dropped, so its turn retries. */
  const prepared = new Map<number, Promise<boolean>>();
  /** Why a track's last load failed, so a skip can say which kind of failure it was. */
  const failures = new Map<number, TapeFailure>();
  const listeners = new Set<() => void>();
  let state: TapeState = { index: 0, positionMs: 0, playing: false, waiting: false, pauseCount: 0, pausedMs: 0, finished: false };
  let pausedAt: number | null = null;
  let disposed = false;
  /** The running gap's timer, so pausing or skipping inside a gap does not leave it ticking. */
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * How to take the current track's listeners back off its element, in the shape `player.ts` uses
   * for the same reason (`detachClip`).
   *
   * Every listener here belongs to one track and must die with it. A `timeupdate` or an `ended`
   * left on an element from an abandoned track fires again as soon as that element is reused, and
   * hands the tape over from a track that is no longer playing — the failure the listening sitting
   * hit on 14 November. There are two kinds: the watcher of the track being played, and the
   * listeners of a load that has not settled yet, which still wants to seek the element back to
   * its own start.
   */
  let detachWatch: (() => void) | null = null;
  const loading = new Map<number, () => void>();
  /**
   * Bumped by every skip. A hand-over that was waiting for a load resumes after the skip has
   * already started something else, and without this it would then start a second track on top.
   */
  let generation = 0;

  /**
   * Takes the playing track's watcher off. Safe to call when there is none, and called from more
   * places than strictly need it — `handOver` and `playFrom` both drop the same watcher, and the
   * watcher drops itself as it fires. That overlap is deliberate: a listener surviving its track
   * is what broke the listening sitting on 14 November, and the cost of dropping twice is nothing.
   * It does mean a mutation that removes any one of those three cannot be caught by a test; what
   * the tests prove is the behaviour (a question plays through, Pause and Next inside the gap come
   * back correctly), not which line did the dropping.
   */
  const dropWatch = () => {
    detachWatch?.();
    detachWatch = null;
  };
  /** Abandons loads in flight: their `loadedmetadata` would seek an element they no longer own. */
  const dropLoads = () => {
    for (const [i, detach] of loading) {
      detach();
      prepared.delete(i);
    }
    loading.clear();
  };

  // A new speed applies to what is being read now, not only to the next track.
  const unsubscribeRate = podcastTtsRate.subscribe(() => {
    const track = tracks[state.index];
    if (!track || track.kind === "silence") return;
    applyRate(elementFor(state.index), rateForTrack(track.kind, podcastTtsRate.get()));
  });

  const set = (patch: Partial<TapeState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const emit = (e: TapeEvent) => onEvent?.(e);
  // Worked out once, over the tracks that have audio: see `elementSlots`. A gap's slot is `null`
  // and every caller below has already ruled a gap out, so the fallback is never reached.
  const slots = elementSlots(tracks);
  const elementFor = (i: number) => els[slots[i] ?? 0]!;
  /** A silent gap owns no element, so "is this track loaded" is only ever asked of the other two. */
  const needsElement = (track: TapeTrack | undefined) => track !== undefined && track.kind !== "silence";
  const label = (track: TapeTrack) => (track.kind === "silence" ? `gap ${track.ms}ms` : track.audio_key.slice(-12));
  const clearGap = () => {
    if (gapTimer === null) return;
    clearTimeout(gapTimer);
    gapTimer = null;
  };

  /**
   * Loads track `i` into the element it will play on, seeked to its start and left paused.
   *
   * Resolves with whether there is anything to play, and the answer is remembered — including a
   * failure, so that one failed load is not turned into an endless row of them by everything that
   * asks. `playFrom` is the one place that tries a failed file again, once, when its turn comes.
   */
  function prepare(i: number): Promise<boolean> {
    const track = tracks[i];
    if (!track || track.kind === "silence") return Promise.resolve(true);
    const existing = prepared.get(i);
    if (existing) return existing;

    const el = elementFor(i);
    const url = mediaUrl(track.audio_key);
    emit({ kind: "preloading", index: i, src: label(track) });
    const promise = new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (why: "ready" | "error" | "timeout") => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // All four of this load's listeners come off, not only the one that fired: `canplay` and
        // `loadedmetadata` outlive a load that failed or timed out, and the element is reused.
        el.removeEventListener("error", onError);
        el.removeEventListener("canplay", settle);
        el.removeEventListener("loadedmetadata", seek);
        loading.delete(i);
        if (why === "ready") {
          failures.delete(i);
          emit({ kind: "ready", index: i });
        } else {
          failures.set(i, why === "timeout" ? "timeout" : failureFromMediaError(el.error?.code));
          emit({ kind: "error", message: `clip ${i + 1}: ${why === "error" ? "không tải được" : "quá hạn tải"}` });
        }
        resolve(why === "ready");
      };
      // Resolved on failure too, never left pending: a clip that cannot load must let the tape
      // move on, not freeze the sitting on a silent screen.
      const timer = setTimeout(() => finish("timeout"), LOAD_TIMEOUT_MS);
      const onError = () => finish("error");
      el.addEventListener("error", onError);

      const settle = () => {
        if (el.readyState >= READY_ENOUGH) finish("ready");
        else el.addEventListener("canplay", settle, { once: true });
      };
      const seek = () => {
        el.currentTime = track.kind === "clip" ? track.start_ms / 1000 : 0;
        settle();
      };
      loading.set(i, () => {
        done = true;
        clearTimeout(timer);
        el.removeEventListener("error", onError);
        el.removeEventListener("canplay", settle);
        el.removeEventListener("loadedmetadata", seek);
        // Resolved, not left pending: whoever is awaiting this load must not wait for ever.
        resolve(false);
      });
      if (el.src.endsWith(url) && el.readyState > 0) seek();
      else {
        el.src = url;
        el.addEventListener("loadedmetadata", seek, { once: true });
        el.load();
      }
    });
    prepared.set(i, promise);
    return promise;
  }

  /** `withinMs` > 0 only when a reopened sitting resumes part way into a clip (M7.13). */
  async function playFrom(i: number, withinMs = 0): Promise<void> {
    if (disposed) return;
    const gen = generation;
    // A safety net on purpose, and the second of two: `handOver` has already dropped the watcher
    // of the track that ended, but `playFrom` is also reached from `start`, and a track must never
    // begin while anything is still listening for another one. Two places dropping the same
    // watcher is the point — 14 November was one place not dropping it.
    dropWatch();
    const track = tracks[i];
    if (!track) {
      emit({ kind: "finished" });
      set({ playing: false, finished: true });
      return;
    }

    // A gap plays nothing: the tape simply stays quiet for as long as the gap says.
    if (track.kind === "silence") {
      set({ index: i, positionMs: 0, playing: true });
      emit({ kind: "playing", index: i, src: label(track) });
      void prepare(i + 1);
      gapTimer = setTimeout(() => {
        gapTimer = null;
        void handOver(i);
      }, track.ms);
      return;
    }

    let playable = await prepare(i);
    if (!playable) {
      // One more try, now that it is this track's turn. A file is preloaded at the start of the
      // track before it, and when that one is a 44-second clip the preload's own 20-second
      // timeout passes while it plays — a load that gave up that long ago says nothing about
      // whether the file can be fetched now.
      prepared.delete(i);
      playable = await prepare(i);
    }
    // A skip while this track's file was loading has already started another one.
    if (disposed || gen !== generation) return;
    if (!playable) {
      // `play()` on an element with no data never fires `ended`, and `ended` is the only thing
      // that hands a file over — playing it would stop the podcast here for good. So this piece
      // is lost and the next one starts: a file nobody can hear costs that file, not the rest.
      emit({ kind: "skipped", index: i, reason: failures.get(i) ?? "network" });
      await handOver(i);
      return;
    }

    const el = elementFor(i);
    // Per track, every time: a TTS file reads at the machine voice's own speed while the exam's
    // recording stays in real time, and the two share these two elements.
    applyRate(el, rateForTrack(track.kind, podcastTtsRate.get()));
    const startMs = track.kind === "clip" ? track.start_ms : 0;
    const within = track.kind === "clip" ? Math.max(0, Math.min(withinMs, track.end_ms - track.start_ms)) : 0;
    el.currentTime = (startMs + within) / 1000;
    set({ index: i, positionMs: within, playing: true });
    emit({ kind: "playing", index: i, src: label(track) });
    void el.play().catch((e: Error) => emit({ kind: "error", message: e.message }));

    // The next track loads while this one plays, on the other element: by the time it is needed the
    // file is in the browser's cache (and the service worker's) and the seek costs nothing.
    void prepare(i + 1);

    attachWatch(i);
  }

  /**
   * Watches track `i` for its end, and records how to stop watching it.
   *
   * Separate from `playFrom` because a pause takes the watcher off and resuming has to put it back:
   * a paused track is still the current one, so it keeps its right to hand over — but it must not
   * keep a listener on an element while something else could be made to play on it.
   *
   * A clip hands over at the paper's own boundary; a whole file has no boundary to watch, so it
   * hands over when the browser says it ended.
   */
  function attachWatch(i: number): void {
    const track = tracks[i];
    if (!track || track.kind === "silence") return;
    // Holds the invariant itself rather than trusting the caller: at most one watcher, ever.
    dropWatch();
    const el = elementFor(i);

    if (track.kind === "file") {
      const tick = () => set({ positionMs: el.currentTime * 1000 });
      const onEnded = () => {
        // Off as it fires, as well as in `handOver`: a second `ended` must not reach a track that
        // is over, whatever happens to the hand-over after this.
        dropWatch();
        void handOver(i);
      };
      el.addEventListener("ended", onEnded);
      el.addEventListener("timeupdate", tick);
      detachWatch = () => {
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("timeupdate", tick);
      };
      return;
    }

    const startMs = track.start_ms;
    const clipEnd = track.end_ms;
    const watch = () => {
      set({ positionMs: el.currentTime * 1000 - startMs });
      if (el.currentTime * 1000 < clipEnd) return;
      dropWatch();
      el.pause();
      void handOver(i);
    };
    el.addEventListener("timeupdate", watch);
    detachWatch = () => el.removeEventListener("timeupdate", watch);
  }

  /** At the end of one track: start the next, or wait in that silence until it loads. */
  async function handOver(from: number): Promise<void> {
    if (disposed) return;
    const gen = generation;
    // The track that is over stops being watched here, and nowhere else: a `timeupdate` or an
    // `ended` left on its element fires again the moment another track is given that element, and
    // hands the tape over from a track that stopped playing long ago (the 14 November fault).
    dropWatch();
    const next = from + 1;
    if (next >= tracks.length) {
      emit({ kind: "finished" });
      set({ playing: false, finished: true });
      return;
    }
    const since = performance.now();
    const pending = prepare(next);
    let waited = 0;
    if (needsElement(tracks[next]) && elementFor(next).readyState < READY_ENOUGH) {
      set({ waiting: true });
      emit({ kind: "waiting", index: next });
      await pending;
      if (disposed || gen !== generation) return;
      waited = Math.round(performance.now() - since);
      set({ waiting: false });
    }
    emit({ kind: "switched", from, to: next, waitedMs: waited });
    await playFrom(next);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,

    /**
     * Call this straight from the tap that starts the sitting — not after an `await`, or the
     * gesture is no longer live and a phone will refuse the second element for the whole session.
     */
    async start(fromMs = 0): Promise<void> {
      // Both `play()` calls are made synchronously, before any await, so each one happens while
      // the tap that triggered them is still the live user gesture. Awaiting the first and then
      // starting the second would spend the gesture on element A and leave B blocked all session.
      const attempts = els.map((el) => {
        el.muted = true;
        el.src = SILENCE;
        return el
          .play()
          .then(() => {
            el.pause();
            return true;
          })
          .catch(() => false);
      });
      const results = await Promise.all(attempts);
      for (const el of els) el.muted = false;
      emit({ kind: "unlocked", blocked: results.filter((ok) => !ok).length });
      // Reopening a sitting resumes where the exam clock says the tape is, not at the beginning:
      // the minutes that passed while the paper was closed have gone, recording and all. Only a
      // sitting ever does this, and a sitting is clips all the way through — a podcast starts at 0.
      const clips = tracks.every((t) => t.kind === "clip") ? (tracks as readonly TopikClip[]) : null;
      const at = clips && fromMs > 0 ? positionOnTimeline(clips, fromMs) : { index: 0, withinMs: 0, past: false };
      if (at.past) {
        emit({ kind: "finished" });
        set({ playing: false, finished: true });
        return;
      }
      await playFrom(at.index, at.withinMs);
    },

    toggle(): void {
      const track = tracks[state.index];
      // Pausing inside a gap is pausing: its timer stops with it and starts again in full when
      // play resumes — a few seconds either way, and never a tape that moves on while paused.
      if (track?.kind === "silence") {
        if (gapTimer !== null) {
          clearGap();
          pausedAt = Date.now();
          set({ pauseCount: state.pauseCount + 1, playing: false });
        } else {
          if (pausedAt !== null) set({ pausedMs: state.pausedMs + (Date.now() - pausedAt) });
          pausedAt = null;
          const index = state.index;
          gapTimer = setTimeout(() => {
            gapTimer = null;
            void handOver(index);
          }, track.ms);
          set({ playing: true });
        }
        return;
      }
      const el = elementFor(state.index);
      if (el.paused) {
        if (pausedAt !== null) set({ pausedMs: state.pausedMs + (Date.now() - pausedAt) });
        pausedAt = null;
        void el.play().catch(() => undefined);
        // The track gets its watcher back, so it still hands over when it ends.
        attachWatch(state.index);
        set({ playing: true });
      } else {
        el.pause();
        // Nothing is playing, so nothing may be listening: a paused track's `ended` or
        // `timeupdate` must not be left on an element that a skip could hand to another track.
        dropWatch();
        pausedAt = Date.now();
        set({ pauseCount: state.pauseCount + 1, playing: false });
      }
    },

    /** Podcast only (F13): start again at track `index` — how "next question" is done. */
    async jumpTo(index: number): Promise<void> {
      if (disposed || index < 0 || index >= tracks.length) return;
      clearGap();
      generation += 1;
      // Everything the tape was in the middle of is abandoned here: the watcher of the track being
      // left, and any load still in flight, whose `loadedmetadata` would otherwise seek the
      // element back to the start of a track nobody is going to hear.
      dropWatch();
      dropLoads();
      for (const el of els) el.pause();
      await playFrom(index);
    },

    stop(): void {
      clearGap();
      dropWatch();
      for (const el of els) el.pause();
      set({ playing: false });
    },

    dispose(): void {
      disposed = true;
      unsubscribeRate();
      clearGap();
      dropWatch();
      dropLoads();
      for (const el of els) {
        el.pause();
        el.removeAttribute("src");
      }
      prepared.clear();
      listeners.clear();
    },
  };
}

// --- the one tape ------------------------------------------------------------------------------
//
// Exactly one tape can be playing, so it lives here rather than inside a component. Owning it per
// component meant React's StrictMode double-mount disposed the very tape it had just built
// (mount → effect → cleanup → effect, with the same object), and the sitting started silent with
// no events at all. A module-level holder has no mount lifecycle to get wrong.

let current: MixedTape | null = null;
const holders = new Set<() => void>();
const notifyHolders = () => holders.forEach((l) => l());

/** Replaces whatever was playing and starts the new tape. Call it straight from the tap. */
export async function startMixedTape(tracks: readonly TapeTrack[], onEvent?: (e: TapeEvent) => void, fromMs = 0): Promise<void> {
  current?.dispose();
  current = createMixedTape(tracks, onEvent);
  // The new tape broadcasts through the module, not to whoever happened to be listening when it
  // was made: a screen subscribes on mount, long before the tape exists, so wiring it the other
  // way round left every later state change unheard and the clock frozen at zero.
  current.subscribe(notifyHolders);
  notifyHolders();
  await current.start(fromMs);
}

export function stopMixedTape(): void {
  current?.stop();
}

export function disposeMixedTape(): void {
  current?.dispose();
  current = null;
  notifyHolders();
}

export const toggleMixedTape = () => current?.toggle();

/** Jumps the one tape to a track (the podcast's "next question"). */
export const jumpMixedTape = (index: number) => void current?.jumpTo(index);

/** Subscribes to every change: the tape's own state, and the tape being replaced. */
export function subscribeMixedTape(listener: () => void): () => void {
  holders.add(listener);
  return () => void holders.delete(listener);
}

export const IDLE_TAPE: TapeState = { index: 0, positionMs: 0, playing: false, waiting: false, pauseCount: 0, pausedMs: 0, finished: false };
export const mixedTapeState = (): TapeState => current?.getState() ?? IDLE_TAPE;
