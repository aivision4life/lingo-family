import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { WORD_ERRORS } from "@shared/word";
import { Button } from "@/components/ui/button";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { cn } from "@/lib/utils";
import { useMarkedWords } from "./markedWords";
import type { SessionSummary } from "./sessionState";
import { useBulkAddWords } from "./useBulkAddWords";

/** Shown once the practice session is done (M6.3; score summary + skip M6.5-ish): the score only
 * ever counts questions actually answered — a skipped one counts toward neither — plus the terms
 * marked "Thêm vào thư viện" while practicing, with a checklist (bớt bớt trước khi thêm) and one
 * button to create them all — full enrichment each, no per-word review screen, run in the
 * background of this very screen. */
export function TopikSessionResults({ summary }: { summary: SessionSummary }) {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const { marked, remove } = useMarkedWords();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const level = profile?.is_kid ? "kid" : "beginner";
  const bulk = useBulkAddWords(profile?.id ?? "", "ko", level);

  if (!profile) return null;

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
    <div className="flex flex-col gap-3">
      <p className="pt-4 text-center text-lg">{t("topik.practice.sessionDone")}</p>
      <div className="flex flex-col items-center gap-1 pb-2 text-center">
        <p className="text-3xl font-bold">{t("topik.practice.results.score", { correct: summary.correct, answered: summary.answered })}</p>
        {summary.skipped > 0 && (
          <p className="text-sm text-muted-foreground">{t("topik.practice.results.skippedNote", { count: summary.skipped })}</p>
        )}
      </div>
      {marked.length > 0 && (
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
                    <span className={cn("ml-auto text-xs", item.status === "error" && "text-destructive", item.status === "done" && "text-green-700 dark:text-green-400")}>
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
      )}
    </div>
  );
}
