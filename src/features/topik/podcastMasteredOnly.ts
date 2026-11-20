// "Chỉ câu đã thuộc" — remembered per device (SPEC F13, M8.1).
//
// A choice about how this person listens, not about their account: the same rule the playback
// speed follows (`src/features/audio/rateSetting.ts`), so it lives in `localStorage` and never
// travels to the Worker as anything but one query parameter.
//
// What "thuộc" means is not decided here and never will be: the server answers that with
// `masteredQuestionIds`, which is M6.11's one definition in `shared/topikMastery.ts`.
import { useSyncExternalStore } from "react";

const KEY = "topik_podcast_mastered_only";

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // A private window can refuse storage: off is still a working choice.
    return false;
  }
};

let current = read();
const listeners = new Set<() => void>();

export const podcastMasteredOnly = {
  get: () => current,
  set(on: boolean) {
    current = on;
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      // Ignore: the choice just won't persist.
    }
    listeners.forEach((l) => l());
  },
  /** The current value inside a component, re-rendering when it changes. */
  use: () =>
    useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      () => current,
    ),
};
