import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ExampleLevel } from "@shared/enums";
import { WORD_ERRORS } from "@shared/word";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMarkedWords } from "./markedWords";
import { useBulkAddWords } from "./useBulkAddWords";

/**
 * The terms marked during a TOPIK session or a sitting, with one button to add them all (M6.3,
 * shared by both screens in M7.12).
 *
 * The checklist exists because marking happens in a hurry, mid-question: this is the moment to
 * drop the ones that turned out to be obvious. What is left is created with full enrichment and
 * **no per-word review screen** — the review already happened when the word was marked — and each
 * word joins the album of the section it was met in.
 */
export function MarkedTermsCard({ profileId, level }: { profileId: string; level: ExampleLevel }) {
  const { t } = useTranslation();
  const { marked, remove } = useMarkedWords();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const bulk = useBulkAddWords(profileId, "ko", level);

  if (marked.length === 0) return null;

  const toggleExcluded = (lemma: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(lemma)) next.delete(lemma);
      else next.add(lemma);
      return next;
    });

  const addAll = async () => {
    const { addedLemmas } = await bulk.run(marked.filter((m) => !excluded.has(m.lemma)));
    for (const lemma of addedLemmas) remove(lemma);
  };

  const quotaItem = bulk.items.find((i) => i.errorCode === WORD_ERRORS.quotaExceeded);

  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3">
      <h2 className="text-sm font-semibold">{t("topik.practice.results.markedTitle")}</h2>
      <ul className="flex flex-col gap-1">
        {marked.map((m) => {
          const item = bulk.items.find((i) => i.lemma === m.lemma);
          return (
            <li key={m.lemma} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={!excluded.has(m.lemma)}
                disabled={bulk.isRunning}
                onChange={() => toggleExcluded(m.lemma)}
                aria-label={m.lemma}
              />
              <span lang="ko" className="font-medium">
                {m.lemma}
              </span>
              <span className="text-muted-foreground">— {m.gloss_vi}</span>
              {item && (
                <span
                  className={cn(
                    "ml-auto text-xs",
                    item.status === "error" && "text-destructive",
                    item.status === "done" && "text-green-700 dark:text-green-400",
                  )}
                >
                  {t(`topik.practice.results.status.${item.status}`)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <Button onClick={() => void addAll()} disabled={bulk.isRunning || marked.every((m) => excluded.has(m.lemma))}>
        {bulk.isRunning ? t("topik.practice.results.adding") : t("topik.practice.results.addAll")}
      </Button>
      {quotaItem && (
        <p role="alert" className="text-sm text-destructive">
          {t("words.errors.quota")}{" "}
          <Link to={`/words/new?lang=ko&term=${encodeURIComponent(quotaItem.lemma)}&autofill=1`} className="underline underline-offset-4">
            {t("topik.practice.results.retryLater")}
          </Link>
        </p>
      )}
    </section>
  );
}
