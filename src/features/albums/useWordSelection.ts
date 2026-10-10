import { useMemo, useState } from "react";
import type { WordSummary } from "@shared/word";
import { emptySelection, prune, selectAll, selectionLang, toggle, type Selection } from "./selection";

/** "Select many" state for a list of words: on/off, the selected ids, and their shared language. */
export function useWordSelection(words: readonly WordSummary[]) {
  const [selecting, setSelecting] = useState(false);
  const [raw, setRaw] = useState<Selection>(emptySelection);

  // The list can change while selecting (search, refresh): ids that are no longer shown are
  // ignored (derived on render, not stored, so there is no state update in an effect).
  const shownKey = words.map((w) => w.id).join(",");
  const selected = useMemo(() => prune(raw, shownKey ? shownKey.split(",") : []), [raw, shownKey]);

  return {
    selecting,
    selected,
    start: () => setSelecting(true),
    stop: () => {
      setSelecting(false);
      setRaw(emptySelection);
    },
    toggle: (id: string) => setRaw(toggle(selected, id)),
    selectAll: () => setRaw(selectAll(words.map((w) => w.id))),
    lang: selectionLang(selected, words),
    ids: [...selected],
  };
}
