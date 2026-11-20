// How a playback speed is remembered and how it is put on an `<audio>` element — one mechanism,
// used by the app's shared player (`player.ts`, key `audio_rate`) and by the podcast's own setting
// for the machine voice (`src/features/topik/podcastRate.ts`). Speed is always the browser's
// `playbackRate`: no second set of audio files is ever generated for it.
import { useSyncExternalStore } from "react";

/** A speed the device remembers, and the only values it will accept back from storage. */
export function createRateSetting<const R extends readonly number[]>(key: string, rates: R, fallback: R[number]) {
  type Rate = R[number];
  const read = (): Rate => {
    try {
      const stored = Number(localStorage.getItem(key));
      return rates.find((r) => r === stored) ?? fallback;
    } catch {
      // A private window can refuse storage: the default is still a working choice.
      return fallback;
    }
  };

  let current: Rate = read();
  const listeners = new Set<() => void>();

  return {
    rates,
    get: (): Rate => current,
    set(rate: Rate) {
      current = rate;
      try {
        localStorage.setItem(key, String(rate));
      } catch {
        // Ignore: the choice just won't persist.
      }
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** The current value inside a component, re-rendering when it changes. */
    use: () => useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      () => current,
    ),
  };
}

/**
 * Puts a speed on an element, keeping the voice's pitch.
 *
 * Both properties, always: loading a new source resets `playbackRate` to `defaultPlaybackRate`,
 * so setting only the first one gives the next file full speed again. `preservesPitch` defaults to
 * true in every current browser, and is set here so a slower voice can never come out deeper.
 */
export function applyRate(el: HTMLAudioElement, rate: number) {
  el.preservesPitch = true;
  el.defaultPlaybackRate = rate;
  el.playbackRate = rate;
}

/** Written as "1.0×" rather than "1×", so the three choices line up. */
export const formatRate = (rate: number) => (Number.isInteger(rate) ? rate.toFixed(1) : String(rate));
