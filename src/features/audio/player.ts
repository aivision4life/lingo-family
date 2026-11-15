// One shared <audio> element for the whole app: starting a sound stops the previous one.
// Speed uses the browser's playbackRate (no extra files) and is remembered per device.
import { useSyncExternalStore } from "react";

export const PLAYBACK_RATES = [1, 0.75] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

const RATE_KEY = "audio_rate";

function readRate(): PlaybackRate {
  try {
    const stored = Number(localStorage.getItem(RATE_KEY));
    return PLAYBACK_RATES.find((r) => r === stored) ?? 1;
  } catch {
    return 1;
  }
}

/**
 * The clip currently playing through `playSegment`, with where the playing head is (M7.2): the
 * segment editor shows a clock and a progress bar, and a clip of a 30-minute exam has no useful
 * position of its own — only its offset inside the clip matters.
 */
export type PlayingClip = { key: string; startMs: number; endMs: number; positionMs: number };
type State = {
  rate: PlaybackRate;
  /** Sound is coming out now. */
  playingKey: string | null;
  clip: PlayingClip | null;
  /** Asked for and on its way: fetching, seeking, buffering. Not playing yet, and not idle either. */
  loadingKey: string | null;
  /** The last request failed (the element's `error`, or nothing arrived in time). */
  errorKey: string | null;
};

let state: State = { rate: readRate(), playingKey: null, clip: null, loadingKey: null, errorKey: null };

/**
 * What a play button should show. "Not playing" used to cover three different situations — nothing
 * asked, on its way, and failed — and all three drew the same "play" button. On a phone, with a
 * 30 MB paper not cached yet, "on its way" lasts a second or two: the tap seemed to do nothing, the
 * second tap restarted the clip, and a load that failed looked exactly like one never started.
 */
export type PlaybackPhase = "idle" | "loading" | "playing" | "error";
export function playbackPhase(s: Pick<State, "playingKey" | "loadingKey" | "errorKey">): PlaybackPhase {
  if (s.loadingKey !== null) return "loading";
  if (s.playingKey !== null) return "playing";
  if (s.errorKey !== null) return "error";
  return "idle";
}

/**
 * How long a request may stay "loading" before it is called a failure. A hung connection fires no
 * `error` at all, and a button that is disabled while loading must never be a dead end.
 */
export const LOAD_TIMEOUT_MS = 20_000;
let loadTimer: ReturnType<typeof setTimeout> | undefined;
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();
const endedListeners = new Set<() => void>();

/**
 * What the element was last ASKED to play. Not the same as what is playing: `playingKey` and
 * `clip` in the state are set only by the element's own `play` / `pause` / `ended` events.
 *
 * They used to be set optimistically, right where `playSegment` / `playAudio` were called, and
 * that is how the button came to lie. `el.pause()` does not fire `pause`, it *queues* it; so the
 * handler that clears the state ran after the optimistic line just below it, on every play that
 * interrupted another one. The button said "play" while the tape ran, and tapping it started the
 * clip again from the top. Events arrive in the order they happened (the old sound's `pause`, then
 * the new one's `playing`), so a state driven by them cannot end up behind the element.
 *
 * `playing`, not `play`: `play` fires the moment play() is called, before a single byte of the new
 * range has arrived, while `playing` fires when sound actually starts. Between the two the request
 * is `loadingKey` — which IS set at the call site, because "you asked and it is on its way" is true
 * from that instant and no event says it.
 */
type Request = { key: string; clip: Pick<PlayingClip, "key" | "startMs" | "endMs"> | null };
let requested: Request | null = null;

/**
 * Detaches whatever the clip started by the latest `playSegment` hung on the element: its
 * `timeupdate` watcher, and the `loadedmetadata` it may still be waiting for.
 *
 * It lives at module scope because a clip is rarely left to finish — Replay, Pause, the next
 * question and unmounting all cut it off — and only this handle can reach the listeners afterwards.
 * `playSegment` used to call `removeEventListener("timeupdate", watch)` with the `watch` it had
 * just created, which removes nothing: every interrupted clip left its watcher on the element for
 * good, still holding its own `stopAt`, and paused the next clip further along the same file on
 * its first `timeupdate`.
 */
let detachClip: (() => void) | null = null;
function dropClip() {
  detachClip?.();
  detachClip = null;
}

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** URL of a stored media file (`audio_key` from the API). */
export const mediaUrl = (key: string) => `/api/media/${key}`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Records a new request and enters "loading" for it; returns it so late callbacks can tell they are stale. */
function ask(request: Request): Request {
  requested = request;
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (requested === request && state.loadingKey !== null) fail();
  }, LOAD_TIMEOUT_MS);
  setState({ loadingKey: request.key, errorKey: null });
  return request;
}

/** Leaves "loading" without sound and without an error (stopped, or the browser refused to start). */
function giveUpLoading() {
  clearTimeout(loadTimer);
  if (state.loadingKey !== null) setState({ loadingKey: null });
}

/** The request failed: out of "loading", and the state says so instead of looking untouched. */
function fail() {
  clearTimeout(loadTimer);
  dropClip();
  audio?.pause();
  setState({ loadingKey: null, playingKey: null, clip: null, errorKey: requested?.key ?? null });
}

/** A refused or interrupted play(): only the request still current may leave "loading" over it. */
const onPlayRejected = (request: Request) => () => {
  if (requested === request) giveUpLoading();
};

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    const el = new Audio();
    const started = () => {
      if (!requested) return;
      clearTimeout(loadTimer);
      const c = requested.clip;
      setState({
        loadingKey: null,
        errorKey: null,
        playingKey: requested.key,
        clip: c ? { ...c, positionMs: clamp(el.currentTime * 1000, c.startMs, c.endMs) } : null,
      });
    };
    el.addEventListener("playing", started);
    // A moving head is sound too: should a browser ever skip `playing`, loading still ends here.
    el.addEventListener("timeupdate", () => {
      if (!el.paused && state.loadingKey !== null) started();
    });
    el.addEventListener("error", () => {
      if (requested) fail();
    });
    el.addEventListener("pause", () => setState({ playingKey: null, clip: null }));
    el.addEventListener("ended", () => {
      setState({ playingKey: null, clip: null });
      endedListeners.forEach((l) => l());
    });
    audio = el;
  }
  return audio;
}

export function playAudio(key: string) {
  const el = ensureAudio();
  el.pause();
  dropClip(); // a whole file has no stop point: no clip's watcher may outlive into it
  const request = ask({ key, clip: null });
  el.src = mediaUrl(key);
  // Loading a new source resets playbackRate to defaultPlaybackRate, so set both.
  el.defaultPlaybackRate = state.rate;
  el.playbackRate = state.rate;
  // A refused play() (no gesture yet) is not a failure: back to idle, the button offers "play".
  el.play().catch(onPlayRejected(request));
}

/**
 * Plays one clip of a longer file (M7.1): from `startMs`, stopping at `endMs`. `fromMs` starts
 * part way into that same window ("go to question 22"): the clip keeps its own start and end, so
 * a progress bar over it does not rescale, and only the playing head moves.
 *
 * The server answers byte ranges, so the browser fetches only the part it needs instead of the
 * whole ~30 MB exam before the first sound. Stopping is done by watching `timeupdate` rather than
 * by a timer: a timer drifts whenever the audio stalls to buffer, and would cut a clip short on a
 * slow connection.
 */
export function playSegment(key: string, startMs: number, endMs: number, fromMs = startMs) {
  const el = ensureAudio();
  const url = mediaUrl(key);
  const stopAt = endMs / 1000;

  const begin = () => {
    el.currentTime = clamp(fromMs, startMs, endMs) / 1000;
    el.play().catch(onPlayRejected(request));
  };
  const watch = () => {
    if (el.paused) return; // a seek reports the time too; only a moving head is progress
    if (el.currentTime < stopAt) {
      setState({ clip: { key, startMs, endMs, positionMs: el.currentTime * 1000 } });
      return;
    }
    el.pause();
    dropClip();
    endedListeners.forEach((l) => l());
  };

  el.pause();
  dropClip(); // the PREVIOUS clip's listeners; see `detachClip`
  const request = ask({ key, clip: { key, startMs, endMs } });
  el.defaultPlaybackRate = state.rate;
  el.playbackRate = state.rate;
  el.addEventListener("timeupdate", watch);
  detachClip = () => {
    el.removeEventListener("timeupdate", watch);
    // Cut off before its metadata arrived, it must not seek the next sound back to its own start.
    el.removeEventListener("loadedmetadata", begin);
  };
  // A fresh source has no duration yet, so seeking has to wait for the metadata.
  if (el.src.endsWith(url)) begin();
  else {
    el.src = url;
    el.addEventListener("loadedmetadata", begin, { once: true });
  }
}

/** Stops whatever is playing (e.g. when the Focus view closes). */
export function stopAudio() {
  audio?.pause();
  dropClip();
  giveUpLoading();
}

/** Calls `listener` each time a sound finishes by itself (not when it is stopped). Returns an unsubscribe function. */
export function onAudioEnded(listener: () => void) {
  endedListeners.add(listener);
  return () => void endedListeners.delete(listener);
}

export function setPlaybackRate(rate: PlaybackRate) {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    // Ignore: the choice just won't persist.
  }
  if (audio) {
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
  }
  setState({ rate });
}

/** The current state without a component around it (tests, and code outside React). */
export const playerSnapshot = () => state;

export function useAudioPlayer() {
  const s = useSyncExternalStore(subscribe, () => state);
  return { ...s, play: playAudio, setRate: setPlaybackRate };
}
