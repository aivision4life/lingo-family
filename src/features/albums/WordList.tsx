import type { UiLang } from "@shared/enums";
import type { WordSummary } from "@shared/word";
import { WordRow } from "@/features/words/LibraryRows";
import type { Selection } from "./selection";

type Props = {
  words: readonly WordSummary[];
  glossLang: UiLang;
  /** In "select many" mode rows are checkboxes. */
  selecting?: boolean;
  selected?: Selection;
  onToggle?: (id: string) => void;
};

/** A bordered list of words (Library and album pages). */
export function WordList({ words, glossLang, selecting, selected, onToggle }: Props) {
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {words.map((w) => (
        <WordRow
          key={w.id}
          w={w}
          glossLang={glossLang}
          select={selecting ? { checked: selected?.has(w.id) ?? false, onToggle: () => onToggle?.(w.id) } : undefined}
        />
      ))}
    </ul>
  );
}
