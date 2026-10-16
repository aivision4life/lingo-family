// Session-only "waiting to add" list for M6.3's bulk-add flow: tapping "Thêm vào thư viện" during
// practice (the word popup, or the wrong-answer key-terms list) never navigates away — it only
// marks the term here. The actual words are created all at once from the session-results screen,
// so answering questions is never interrupted. Lives only in memory (not D1): a fresh practice
// session starts with an empty list.
import { createContext, useContext } from "react";

export type MarkedTerm = { lemma: string; gloss_vi: string };

/** Pure: toggles `lemma` in `marked` (adds it with `gloss_vi` if absent, removes it if present). */
export function toggleMarked(marked: MarkedTerm[], lemma: string, gloss_vi: string): MarkedTerm[] {
  return marked.some((m) => m.lemma === lemma) ? marked.filter((m) => m.lemma !== lemma) : [...marked, { lemma, gloss_vi }];
}

export type MarkedWordsValue = {
  marked: MarkedTerm[];
  isMarked: (lemma: string) => boolean;
  toggle: (lemma: string, gloss_vi: string) => void;
  /** Called once a marked term is safely saved to the library, so it stops needing the "unsaved
   * marks, are you sure you want to leave?" guard. */
  remove: (lemma: string) => void;
};

export const MarkedWordsContext = createContext<MarkedWordsValue | null>(null);

export function useMarkedWords(): MarkedWordsValue {
  const ctx = useContext(MarkedWordsContext);
  if (!ctx) throw new Error("useMarkedWords must be used inside <MarkedWordsProvider>");
  return ctx;
}
