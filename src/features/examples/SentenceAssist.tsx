import { RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import { LangText } from "@/components/LangText";
import { Button } from "@/components/ui/button";
import { isRetryableAiError, wordErrorMessage } from "@/features/words/format";
import { useSentenceAssist, type SentenceAssistState } from "./useSentenceAssist";

type PanelProps = {
  assist: SentenceAssistState;
  lang: LearnLang;
  text: string;
  rootTerm: string;
  label: string;
};

/** The "AI translate & illustrate" button with its status, warning and suggestion (never auto-applied). */
export function SentenceAssistPanel({ assist, lang, text, rootTerm, label }: PanelProps) {
  const { t } = useTranslation();
  const result = assist.resultFor(text);
  const suggestion = result && !result.suggestionHandled ? result.check.suggestion : null;

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" className="self-start" disabled={assist.pending || text.trim() === ""} onClick={() => assist.run(text)}>
        <Sparkles aria-hidden />
        {assist.pending ? t("examples.assist.working") : label}
      </Button>
      {assist.error && !assist.pending && (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
          <p>{wordErrorMessage(assist.error, t)}</p>
          {isRetryableAiError(assist.error) && (
            <Button type="button" variant="outline" onClick={() => assist.run(text)}>
              <RefreshCw aria-hidden />
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}
      {result && !assist.error && <p role="status" className="text-sm text-muted-foreground">{t("examples.assist.done")}</p>}
      {assist.warn(text) && (
        <p role="status" className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("examples.assist.containsWord", { word: rootTerm })}
        </p>
      )}
      {suggestion && (
        <div role="group" aria-label={t("examples.assist.suggestionTitle")} className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <span className="text-sm font-medium">{t("examples.assist.suggestionTitle")}</span>
          <LangText lang={lang} className="text-lg font-semibold">
            {suggestion.text}
          </LangText>
          {result?.check.note_vi && (
            <span lang="vi" className="text-sm text-muted-foreground">
              {result.check.note_vi}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={assist.useSuggestion}>
              {t("examples.assist.useSuggestion")}
            </Button>
            <Button type="button" variant="outline" onClick={assist.keepMine}>
              {t("examples.assist.keepMine")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type Props = Omit<PanelProps, "assist" | "label"> & {
  profileId: string;
  rootGloss: string;
  label?: string;
  onApply: Parameters<typeof useSentenceAssist>[0]["onApply"];
};

/** Hook + panel in one component (Add word screen, phrase forms). */
export function SentenceAssist({ lang, text, rootTerm, rootGloss, profileId, label, onApply }: Props) {
  const { t } = useTranslation();
  const assist = useSentenceAssist({ lang, rootTerm, rootGloss, profileId, onApply });
  return <SentenceAssistPanel assist={assist} lang={lang} text={text} rootTerm={rootTerm} label={label ?? t("examples.assist.sentenceButton")} />;
}
