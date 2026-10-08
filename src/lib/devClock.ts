// Dev-only time travel for trying review schedules (SPEC F4, M1.4).
// In production builds import.meta.env.DEV is false, so the offset is always 0 and no header is sent;
// the server also ignores the header unless DEV_TIME_TRAVEL=1.
import { useSyncExternalStore } from "react";
import { DEV_NOW_HEADER } from "@shared/review";

const KEY = "dev_day_offset";
const DAY_MS = 24 * 60 * 60 * 1000;
const listeners = new Set<() => void>();

function readOffset(): number {
  if (!import.meta.env.DEV) return 0;
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}

let offsetDays = readOffset();

export function setDevDayOffset(days: number) {
  if (!import.meta.env.DEV) return;
  offsetDays = days;
  try {
    localStorage.setItem(KEY, String(days));
  } catch {
    // Ignore: the offset just won't persist.
  }
  listeners.forEach((l) => l());
}

/** "Now" as seen by the app (shifted by the dev offset in development). */
export const appNow = () => new Date(Date.now() + offsetDays * DAY_MS);

/** Header carrying the fake date, only when a dev offset is active. */
export const devNowHeaders = (): Record<string, string> =>
  import.meta.env.DEV && offsetDays !== 0 ? { [DEV_NOW_HEADER]: appNow().toISOString() } : {};

export function useDevDayOffset() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => offsetDays,
  );
}

/** Device UTC offset in minutes east of UTC (Korea: 540), sent so "today" uses local midnight. */
export const tzOffsetMinutes = () => -new Date().getTimezoneOffset();
