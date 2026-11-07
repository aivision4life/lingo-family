import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useMarkedWords } from "./markedWords";
import { useMarkSource } from "./markSource";

/** "Thêm vào thư viện" during practice (M6.3): marks the term for the session's end-of-practice
 * bulk-add instead of navigating away, so answering questions is never interrupted. */
export function TopikMarkToggle({ lemma, gloss_vi }: { lemma: string; gloss_vi: string }) {
  const { t } = useTranslation();
  const { isMarked, toggle } = useMarkedWords();
  const source = useMarkSource();
  const marked = isMarked(lemma);
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
