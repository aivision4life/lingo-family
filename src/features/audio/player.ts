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

type State = { rate: PlaybackRate; playingKey: string | null };

let state: State = { rate: readRate(), playingKey: null };
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

export function playAudio(key: string) {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("ended", () => {
      setState({ playingKey: null });
      endedListeners.forEach((l) => l());
    });
    audio.addEventListener("pause", () => setState({ playingKey: null }));
  }
  audio.pause();
  audio.src = mediaUrl(key);
  // Loading a new source resets playbackRate to defaultPlaybackRate, so set both.
  audio.defaultPlaybackRate = state.rate;
  audio.playbackRate = state.rate;
  setState({ playingKey: key });
  audio.play().catch(() => setState({ playingKey: null }));
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
