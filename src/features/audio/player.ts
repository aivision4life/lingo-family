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
type State = { rate: PlaybackRate; playingKey: string | null; clip: PlayingClip | null };

let state: State = { rate: readRate(), playingKey: null, clip: null };
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();
const endedListeners = new Set<() => void>();

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

function ensureAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("ended", () => {
      setState({ playingKey: null, clip: null });
      endedListeners.forEach((l) => l());
    });
    audio.addEventListener("pause", () => setState({ playingKey: null, clip: null }));
  }
  return audio;
}

export function playAudio(key: string) {
  ensureAudio();
  audio!.pause();
  audio!.src = mediaUrl(key);
  // Loading a new source resets playbackRate to defaultPlaybackRate, so set both.
  audio!.defaultPlaybackRate = state.rate;
  audio!.playbackRate = state.rate;
  setState({ playingKey: key, clip: null });
  audio!.play().catch(() => setState({ playingKey: null }));
}

/**
 * Plays one clip of a longer file (M7.1): seeks to `startMs` and stops at `endMs`.
 *
 * The server answers byte ranges, so the browser fetches only the part it needs instead of the
 * whole ~30 MB exam before the first sound. Stopping is done by watching `timeupdate` rather than
 * by a timer: a timer drifts whenever the audio stalls to buffer, and would cut a clip short on a
 * slow connection.
 */
export function playSegment(key: string, startMs: number, endMs: number) {
  const el = ensureAudio();
  const url = mediaUrl(key);
  const start = startMs / 1000;
  const stopAt = endMs / 1000;

  const begin = () => {
    el.currentTime = start;
    el.play().catch(() => setState({ playingKey: null }));
  };
  const watch = () => {
    if (el.currentTime < stopAt) {
      setState({ clip: { key, startMs, endMs, positionMs: el.currentTime * 1000 } });
      return;
    }
    el.pause();
    el.removeEventListener("timeupdate", watch);
    endedListeners.forEach((l) => l());
  };

  el.pause();
  el.removeEventListener("timeupdate", watch);
  el.defaultPlaybackRate = state.rate;
  el.playbackRate = state.rate;
  setState({ playingKey: key, clip: { key, startMs, endMs, positionMs: startMs } });
  el.addEventListener("timeupdate", watch);
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

export function useAudioPlayer() {
  const s = useSyncExternalStore(subscribe, () => state);
  return { ...s, play: playAudio, setRate: setPlaybackRate };
}
