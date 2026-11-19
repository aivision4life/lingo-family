import { useEffect, useSyncExternalStore } from "react";
import {
  disposeMixedTape,
  jumpMixedTape,
  mixedTapeState,
  startMixedTape,
  stopMixedTape,
  subscribeMixedTape,
  toggleMixedTape,
  type TapeEvent,
  type TapeTrack,
} from "./mixedTape";

/**
 * Reads the one mixed tape (M6.5) and stops it when the screen goes away.
 *
 * The tape is module-level, not owned by this hook: owning it per component meant StrictMode's
 * double mount disposed the tape it had just created, and the sitting started silent.
 */
export function useMixedTape() {
  const state = useSyncExternalStore(subscribeMixedTape, mixedTapeState);
  useEffect(() => disposeMixedTape, []);
  return {
    ...state,
    /** Must be called straight from the tap, so both `<audio>` elements unlock while it is live.
     * `fromMs` is where the exam clock says the tape should be — 0 at the start of a sitting, and
     * the time already gone when a reopened one is resumed (M7.13). */
    start: (tracks: readonly TapeTrack[], onEvent?: (e: TapeEvent) => void, fromMs = 0) => startMixedTape(tracks, onEvent, fromMs),
    toggle: toggleMixedTape,
    /** Podcast only: start again at a given track, which is how "next question" works (F13). */
    jumpTo: jumpMixedTape,
    stop: stopMixedTape,
  };
}
