import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useMarkedWords } from "./markedWords";
import { useMarkSource } from "./markSource";

/** "Thêm vào thư viện" during practice (M6.3): marks the term for the session's end-of-practice
 * bulk-add instead of navigating away, so answering questions is never interrupted. */
export function TopikMarkToggle({ lemma, gloss_vi }: { lemma: string; gloss_vi: string }) {
  const { t } = useTranslation();
  const { isMarked, toggle } = useMarkedWords();
  // Null only where the screen genuinely cannot attribute the word — a question deleted since
  // the sitting it was met in. Nothing to file it under, so nothing to offer (M7.22).
  const source = useMarkSource();
  const marked = isMarked(lemma);
  // The invariant `useMarkSource` used to defend with a throw, kept as a render decision instead:
  // no source, no button, so `toggle` can never be reached without one.
  if (!source) return null;
  return (
    <button
      type="button"
      aria-pressed={marked}
      onClick={() => toggle({ lemma, gloss_vi, source })}
      className={cn("text-sm font-medium underline underline-offset-4", marked ? "text-muted-foreground" : "text-primary")}
    >
      {marked ? t("topik.practice.word.marked") : t("topik.practice.word.addToLibrary")}
    </button>
  );
}
