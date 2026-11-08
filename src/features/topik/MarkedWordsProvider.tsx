import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MarkedWordsContext, toggleMarked, type MarkedTerm } from "./markedWords";

/**
 * Holds the "waiting to add" list for one screen.
 *
 * `initialMarked` is read **once**, when this provider mounts: a screen that restores a saved list
 * (M7.19) must therefore not render this until it knows what to restore, or the list arriving
 * later would be ignored. `onChange` is how the owning screen persists the list — pass a stable
 * (`useCallback`) function, since it runs whenever the list changes; a screen with nothing to
 * persist leaves it out.
 */
export function MarkedWordsProvider({
  children,
  initialMarked = [],
  onChange,
}: {
  children: ReactNode;
  initialMarked?: MarkedTerm[];
  onChange?: (marked: MarkedTerm[]) => void;
}) {
  const [marked, setMarked] = useState<MarkedTerm[]>(initialMarked);
  const toggle = useCallback((term: MarkedTerm) => setMarked((prev) => toggleMarked(prev, term)), []);
  const remove = useCallback((lemma: string) => setMarked((prev) => prev.filter((m) => m.lemma !== lemma)), []);
  const isMarked = useCallback((lemma: string) => marked.some((m) => m.lemma === lemma), [marked]);
  const value = useMemo(() => ({ marked, isMarked, toggle, remove }), [marked, isMarked, toggle, remove]);

  useEffect(() => {
    onChange?.(marked);
  }, [marked, onChange]);

  return <MarkedWordsContext.Provider value={value}>{children}</MarkedWordsContext.Provider>;
}
