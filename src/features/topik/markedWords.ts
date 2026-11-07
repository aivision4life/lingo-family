// Session-only "waiting to add" list for M6.3's bulk-add flow: tapping "Thêm vào thư viện" during
// practice (the word popup, or the wrong-answer key-terms list) never navigates away — it only
// marks the term here. The actual words are created all at once from the session-results screen,
// so answering questions is never interrupted. Lives only in memory (not D1): a fresh practice
// session starts with an empty list.
import { createContext, useContext } from "react";
import type { TopikWordSource } from "@shared/topik";

/** A term waiting to be added, with the question it was met in: that decides which TOPIK album it
 * joins (M7.12). A term met twice keeps the first question — where you actually met it. */
export type MarkedTerm = { lemma: string; gloss_vi: string; source: TopikWordSource };

/** Pure: toggles `term.lemma` in `marked` (adds the term if absent, removes it if present). */
export function toggleMarked(marked: MarkedTerm[], term: MarkedTerm): MarkedTerm[] {
  return marked.some((m) => m.lemma === term.lemma) ? marked.filter((m) => m.lemma !== term.lemma) : [...marked, term];
}

export type MarkedWordsValue = {
  marked: MarkedTerm[];
  isMarked: (lemma: string) => boolean;
  toggle: (term: MarkedTerm) => void;
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
