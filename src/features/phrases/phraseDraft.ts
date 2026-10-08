// Editable phrase draft (AI suggestion or typed by hand) and conversion to the API input.
import type { ExampleLevel } from "@shared/enums";
import { phraseInputSchema, type LlmPhrase, type Phrase, type PhraseInput } from "@shared/phrase";

export type PhraseDraft = {
  /** Local key for React lists. */
  key: string;
  /** Ticked to be saved (suggestions start unticked, SPEC F2). */
  selected: boolean;
  text: string;
  reading: string;
  gloss_vi: string;
  gloss_en: string;
  gloss_ko: string;
  sentence: string;
  translation_vi: string;
  translation_en: string;
  translation_ko: string;
  ai_generated: boolean;
};

export type PhraseTextField = Exclude<keyof PhraseDraft, "key" | "selected" | "ai_generated">;
/** Field → true when invalid. */
export type PhraseDraftErrors = Partial<Record<PhraseTextField, true>>;

let seq = 0;
const newKey = () => `ph-${++seq}`;

export const draftFromSuggestion = (p: LlmPhrase): PhraseDraft => ({
  key: newKey(),
  selected: false,
  text: p.text,
  reading: p.reading,
  gloss_vi: p.gloss_vi,
  gloss_en: p.gloss_en,
  gloss_ko: p.gloss_ko,
  ...p.example,
  ai_generated: true,
});

export const emptyPhraseDraft = (): PhraseDraft => ({
  key: newKey(),
  selected: true,
  text: "",
  reading: "",
  gloss_vi: "",
  gloss_en: "",
  gloss_ko: "",
  sentence: "",
  translation_vi: "",
  translation_en: "",
  translation_ko: "",
  ai_generated: false,
});

export const draftFromPhrase = (p: Phrase): PhraseDraft => {
  const ex = p.examples[0];
  return {
    key: p.id,
    selected: true,
    text: p.text,
    reading: p.reading,
    gloss_vi: p.gloss_vi,
    gloss_en: p.gloss_en,
    gloss_ko: p.gloss_ko,
    sentence: ex?.sentence ?? "",
    translation_vi: ex?.translation_vi ?? "",
    translation_en: ex?.translation_en ?? "",
    translation_ko: ex?.translation_ko ?? "",
    ai_generated: p.ai_generated,
  };
};

/** API input for one draft; a blank sentence means "no example". */
export function phraseDraftToInput(
  d: PhraseDraft,
  level: ExampleLevel,
): { input: PhraseInput; errors: null } | { input: null; errors: PhraseDraftErrors } {
  const input: PhraseInput = {
    text: d.text,
    reading: d.reading,
    gloss_vi: d.gloss_vi,
    gloss_en: d.gloss_en,
    gloss_ko: d.gloss_ko,
    ai_generated: d.ai_generated,
    example:
      d.sentence.trim() === ""
        ? null
        : {
            sentence: d.sentence,
            translation_vi: d.translation_vi,
            translation_en: d.translation_en,
            translation_ko: d.translation_ko,
            level,
            ai_generated: d.ai_generated,
          },
  };
  const result = phraseInputSchema.safeParse(input);
  if (result.success) return { input, errors: null };
  const errors: PhraseDraftErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] === "example" ? issue.path[1] : issue.path[0];
    if (typeof field === "string" && field in d) errors[field as PhraseTextField] = true;
  }
  return { input: null, errors };
}

/** Inputs for all ticked drafts, or the errors per draft key. */
export function selectedPhraseInputs(drafts: PhraseDraft[], level: ExampleLevel) {
  const inputs: PhraseInput[] = [];
  const errors: Record<string, PhraseDraftErrors> = {};
  for (const d of drafts.filter((x) => x.selected)) {
    const r = phraseDraftToInput(d, level);
    if (r.input) inputs.push(r.input);
    else errors[d.key] = r.errors;
  }
  return { inputs, errors, ok: Object.keys(errors).length === 0 };
}
