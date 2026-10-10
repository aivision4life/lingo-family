// "Connection lost" state shared by the API layer and the banner (src/features/pwa).
import { useSyncExternalStore } from "react";
import { browserFailureDeps, handleFetchFailure } from "./accessSession";

let lost = false;
const listeners = new Set<() => void>();
const set = (value: boolean) => {
  if (lost === value) return;
  lost = value;
  listeners.forEach((l) => l());
};

let inFlight: Promise<void> | null = null;

/**
 * Called when a request to /api threw a network error: checks whether the Access session expired
 * (then the page reloads to reach the login page) or the network is down (then the banner shows).
 * Concurrent failures share one probe.
 */
export function noteFetchFailure(): Promise<void> {
  inFlight ??= handleFetchFailure(browserFailureDeps)
    .then((outcome) => set(outcome === "offline"))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Any successful API answer proves the connection is back. */
export const noteFetchSuccess = () => set(false);
export const dismissConnectionLost = () => set(false);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useConnectionLost = () => useSyncExternalStore(subscribe, () => lost);
