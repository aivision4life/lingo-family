import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HTML_LANG } from "@/lib/htmlLang";
import { exampleErrorKey, useAddExample, usePatchExample } from "./api";
import { applyFields, buildCreate, buildPatch, editNeedsAiStep, emptyForm, formFromExample, withSentence, type ExampleFormState } from "./exampleFormState";
import { ImagePromptField } from "./ImagePromptField";
import { SentenceAssistPanel } from "./SentenceAssist";
import { useSentenceAssist } from "./useSentenceAssist";

type Original = Parameters<typeof formFromExample>[0] & { id: string };

type Props = {
  wordId: string;
  lang: LearnLang;
  profileId: string;
  rootTerm: string;
  rootGloss: string;
  /** The sentence being edited; absent = adding a new one. */
  original?: Original;
  /** Adding to this phrase instead of the word itself. */
  phraseId?: string | null;
  onDone: () => void;
  onCancel: () => void;
};

const TRANSLATIONS = ["vi", "en", "ko"] as const;

/** Add / edit one example sentence of a saved word or phrase, with the AI help (M2.6). */
export function ExampleForm({ wordId, lang, profileId, rootTerm, rootGloss, original, phraseId = null, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const fieldId = useId();
  const add = useAddExample(wordId);
  const patch = usePatchExample(original?.id ?? "");
  const [state, setState] = useState<ExampleFormState>(() => (original ? formFromExample(original) : emptyForm()));
  const [reviewing, setReviewing] = useState(false);
  const assist = useSentenceAssist({
    lang,
    rootTerm,
    rootGloss,
    profileId,
    onApply: (f) => setState((s) => applyFields(s, f)),
  });
  const saving = add.isPending || patch.isPending;
  const error = add.error ?? patch.error;
  const textChanged = original ? state.sentence !== original.sentence : false;

  const save = () => {
    if (state.sentence.trim() === "") return;
    if (original) {
      // "Update meaning & picture with AI": the first press runs the AI so the translations can be reviewed.
      if (editNeedsAiStep(state, original.sentence)) {
        assist.run(state.sentence, () => setReviewing(true));
        return;
      }
      patch.mutate(buildPatch(state, original, lang, profileId), { onSuccess: onDone });
    } else {
      add.mutate(buildCreate(state, lang, profileId, phraseId), { onSuccess: onDone });
    }
  };

  const set = (patchState: Partial<ExampleFormState>) => setState((s) => ({ ...s, ...patchState }));
  const needsAiStep = !!original && editNeedsAiStep(state, original.sentence);

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Label htmlFor={fieldId}>{t("examples.form.sentence")}</Label>
      <Input
        id={fieldId}
        lang={HTML_LANG[lang]}
        value={state.sentence}
        autoFocus
        onChange={(e) => {
          setReviewing(false);
          setState((s) => withSentence(s, e.target.value, original?.sentence ?? null));
        }}
      />
      <SentenceAssistPanel assist={assist} lang={lang} text={state.sentence} rootTerm={rootTerm} label={t("examples.assist.sentenceButton")} />
      {TRANSLATIONS.filter((l) => l !== lang).map((l) => (
        <Input
          key={l}
          lang={l}
          aria-label={t(`words.fields.translation_${l}`)}
          placeholder={t(`words.fields.translation_${l}`)}
          value={state[`translation_${l}`]}
          onChange={(e) => set({ [`translation_${l}`]: e.target.value })}
        />
      ))}
      <ImagePromptField value={state.image_prompt} onChange={(image_prompt) => set({ image_prompt })} />
      {original && textChanged && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={state.refresh} onChange={(e) => set({ refresh: e.target.checked })} />
          {t("examples.form.refresh")}
        </label>
      )}
      {reviewing && <p role="status" className="text-sm text-muted-foreground">{t("examples.form.reviewHint")}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(exampleErrorKey(error))}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving || assist.pending || state.sentence.trim() === ""}>
          {needsAiStep ? t("examples.form.refreshStep") : t("examples.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
