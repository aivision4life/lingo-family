// "Auto-play" preference of the Focus view, remembered per device (default: on).
import { useSyncExternalStore } from "react";

const KEY = "focus_autoplay";

/** Anything but an explicit "0" means on, so the default (nothing stored) is on. */
export const parseAutoplay = (stored: string | null): boolean => stored !== "0";

function read(): boolean {
  try {
    return parseAutoplay(localStorage.getItem(KEY));
  } catch {
    return true;
  }
}

let value = read();
const listeners = new Set<() => void>();

export function setAutoplay(on: boolean) {
  value = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // The choice just does not persist (private mode).
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useAutoplay = () => useSyncExternalStore(subscribe, () => value);
