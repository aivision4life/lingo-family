import { Plus, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExampleLevel, LearnLang } from "@shared/enums";
import type { SkippedPhrase } from "@shared/phrase";
import { Button } from "@/components/ui/button";
import { isRetryableAiError, wordErrorMessage } from "@/features/words/format";
import { useSavePhrases, useSuggestPhrases } from "./api";
import {
  draftFromSuggestion,
  emptyPhraseDraft,
  selectedPhraseInputs,
  type PhraseDraft,
  type PhraseDraftErrors,
} from "./phraseDraft";
import { PhraseFields } from "./PhraseFields";
import { PhraseSuggestionList } from "./PhraseSuggestionList";
import { SkippedNotice } from "./SkippedNotice";

type Props = { wordId: string; lang: LearnLang; profileId: string; level: ExampleLevel; rootTerm: string; rootGloss: string };
type Mode = "idle" | "suggest" | "manual";

/** Adults: "Suggest phrases" (AI, tick to keep) or "Add a phrase by hand" for a saved word. */
export function PhraseAdder({ wordId, lang, profileId, level, rootTerm, rootGloss }: Props) {
  const assist = { profileId, rootTerm, rootGloss };
  const { t } = useTranslation();
  const suggest = useSuggestPhrases(wordId);
  const save = useSavePhrases(wordId);
  const [mode, setMode] = useState<Mode>("idle");
  const [drafts, setDrafts] = useState<PhraseDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, PhraseDraftErrors>>({});
  const [skipped, setSkipped] = useState<SkippedPhrase[]>([]);

  const close = () => {
    setMode("idle");
    setDrafts([]);
    setErrors({});
  };

  const startSuggest = () => {
    setSkipped([]);
    suggest.mutate(
      { profileId, level },
      {
        onSuccess: (r) => {
          setDrafts(r.phrases.map(draftFromSuggestion));
          setMode("suggest");
        },
      },
    );
  };

  const startManual = () => {
    setSkipped([]);
    setDrafts([emptyPhraseDraft()]);
    setMode("manual");
  };

  const submit = () => {
    const r = selectedPhraseInputs(drafts, level);
    setErrors(r.errors);
    if (!r.ok || r.inputs.length === 0) return;
    save.mutate(
      { profileId, phrases: r.inputs },
      {
        onSuccess: (res) => {
          setSkipped(res.skipped);
          close();
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <SkippedNotice skipped={skipped} />
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={suggest.isPending} onClick={startSuggest}>
            <Sparkles aria-hidden />
            {suggest.isPending ? t("phrases.suggesting") : t("phrases.suggest")}
          </Button>
          <Button variant="outline" onClick={startManual}>
            <Plus aria-hidden />
            {t("phrases.addManual")}
          </Button>
        </div>
      )}
      {suggest.isError && mode === "idle" && (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
          <p>{wordErrorMessage(suggest.error, t)}</p>
          {isRetryableAiError(suggest.error) && (
            <Button type="button" variant="outline" onClick={startSuggest}>
              <RefreshCw aria-hidden />
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}

      {mode === "suggest" && drafts.length === 0 && <p className="text-muted-foreground">{t("phrases.noSuggestions")}</p>}
      {mode === "suggest" && drafts.length > 0 && (
        <PhraseSuggestionList lang={lang} drafts={drafts} errors={errors} onChange={setDrafts} assist={assist} />
      )}
      {mode === "manual" && drafts[0] && (
        <div className="rounded-lg border p-3">
          <PhraseFields
            lang={lang}
            draft={drafts[0]}
            errors={errors[drafts[0].key]}
            onChange={(p) => setDrafts([{ ...drafts[0]!, ...p }])}
            assist={assist}
          />
        </div>
      )}
      {mode !== "idle" && (
        <div className="flex flex-wrap gap-2">
          {drafts.length > 0 && (
            <Button onClick={submit} disabled={save.isPending || !drafts.some((d) => d.selected)}>
              {mode === "manual" ? t("phrases.save") : t("phrases.saveSelected")}
            </Button>
          )}
          <Button variant="outline" onClick={close}>{t("common.cancel")}</Button>
        </div>
      )}
      {save.isError && <p role="alert" className="text-sm text-destructive">{t("words.errors.generic")}</p>}
    </div>
  );
}
