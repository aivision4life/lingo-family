import { useState } from "react";
import { normalizeTerm } from "@shared/base";
import type { SentenceCheck, SentenceFields } from "@shared/customItem";
import type { LearnLang } from "@shared/enums";
import { useEnrichSentence } from "./api";
import { showContainsWarning } from "./exampleFormState";

type Options = {
  lang: LearnLang;
  rootTerm: string;
  rootGloss: string;
  profileId: string;
  /** Receives the checked sentence (translations + picture prompt) or, if chosen, the suggestion. */
  onApply: (fields: SentenceFields) => void;
};

type Result = { forText: string; check: SentenceCheck; suggestionHandled: boolean };

/** "AI translate & illustrate" for a typed sentence: one call, checked result, suggestion handling. */
export function useSentenceAssist({ lang, rootTerm, rootGloss, profileId, onApply }: Options) {
  const enrich = useEnrichSentence();
  const [result, setResult] = useState<Result | null>(null);

  /** Runs the AI for `text`; resolves true when a result was applied. */
  const run = (text: string, onDone?: (check: SentenceCheck) => void) =>
    enrich.mutate(
      { profile_id: profileId, lang, text, word_term: rootTerm, word_gloss: rootGloss },
      {
        onSuccess: ({ check }) => {
          setResult({ forText: normalizeTerm(check.sentence.text), check, suggestionHandled: false });
          onApply(check.sentence);
          onDone?.(check);
        },
      },
    );

  const useSuggestion = () => {
    if (!result?.check.suggestion) return;
    onApply(result.check.suggestion);
    setResult({ ...result, forText: normalizeTerm(result.check.suggestion.text), suggestionHandled: true });
  };
  const keepMine = () => result && setResult({ ...result, suggestionHandled: true });

  return {
    pending: enrich.isPending,
    error: enrich.error,
    run,
    reset: () => {
      enrich.reset();
      setResult(null);
    },
    useSuggestion,
    keepMine,
    /** The current result, only while it still belongs to the sentence in the field. */
    resultFor: (text: string) => (result && result.forText === normalizeTerm(text) ? result : null),
    warn: (text: string) => {
      const r = result && result.forText === normalizeTerm(text) ? result : null;
      return !!r && showContainsWarning(text, rootTerm, r.check.contains_word);
    },
  };
}

export type SentenceAssistState = ReturnType<typeof useSentenceAssist>;
