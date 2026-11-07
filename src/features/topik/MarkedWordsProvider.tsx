import { useCallback, useMemo, useState, type ReactNode } from "react";
import { MarkedWordsContext, toggleMarked, type MarkedTerm } from "./markedWords";

export function MarkedWordsProvider({ children }: { children: ReactNode }) {
  const [marked, setMarked] = useState<MarkedTerm[]>([]);
  const toggle = useCallback((term: MarkedTerm) => setMarked((prev) => toggleMarked(prev, term)), []);
  const remove = useCallback((lemma: string) => setMarked((prev) => prev.filter((m) => m.lemma !== lemma)), []);
  const isMarked = useCallback((lemma: string) => marked.some((m) => m.lemma === lemma), [marked]);
  const value = useMemo(() => ({ marked, isMarked, toggle, remove }), [marked, isMarked, toggle, remove]);
  return <MarkedWordsContext.Provider value={value}>{children}</MarkedWordsContext.Provider>;
}
