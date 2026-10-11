import { RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeTerm } from "@shared/base";
import type { PhraseFill } from "@shared/customItem";
import type { LearnLang } from "@shared/enums";
import { Button } from "@/components/ui/button";
import { isRetryableAiError, wordErrorMessage } from "@/features/words/format";
import { useEnrichPhrase } from "./api";
import { showContainsWarning } from "./exampleFormState";

type Props = {
  lang: LearnLang;
  text: string;
  rootTerm: string;
  rootGloss: string;
  profileId: string;
  /** Receives the reading, the three meanings and the picture prompt of the phrase. */
  onApply: (fill: PhraseFill) => void;
};

/** "AI fill meaning & reading" for a phrase typed by hand: one call; the user edits the fields afterwards. */
export function PhraseAssist({ lang, text, rootTerm, rootGloss, profileId, onApply }: Props) {
  const { t } = useTranslation();
  const enrich = useEnrichPhrase();
  const [done, setDone] = useState<{ forText: string; containsWord: boolean } | null>(null);
  const current = done && done.forText === normalizeTerm(text) ? done : null;

  const run = () =>
    enrich.mutate(
      { profile_id: profileId, lang, text, word_term: rootTerm, word_gloss: rootGloss },
      {
        onSuccess: ({ fill }) => {
          setDone({ forText: normalizeTerm(fill.text), containsWord: fill.contains_word });
          onApply(fill);
        },
      },
    );

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" className="self-start" disabled={enrich.isPending || text.trim() === ""} onClick={run}>
        <Sparkles aria-hidden />
        {enrich.isPending ? t("examples.assist.working") : t("examples.assist.phraseButton")}
      </Button>
      {enrich.isError && !enrich.isPending && (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
          <p>{wordErrorMessage(enrich.error, t)}</p>
          {isRetryableAiError(enrich.error) && (
            <Button type="button" variant="outline" onClick={run}>
              <RefreshCw aria-hidden />
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}
      {current && !enrich.isError && <p role="status" className="text-sm text-muted-foreground">{t("examples.assist.done")}</p>}
      {current && showContainsWarning(text, rootTerm, current.containsWord) && (
        <p role="status" className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("examples.assist.containsWord", { word: rootTerm })}
        </p>
      )}
    </div>
  );
}
