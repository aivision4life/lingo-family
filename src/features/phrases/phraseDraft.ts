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
  /** Image prompts of the phrase and of its example (from AI; not shown in the form). */
  image_prompt: string | null;
  example_image_prompt: string | null;
};

export type PhraseTextField = Exclude<
  keyof PhraseDraft,
  "key" | "selected" | "ai_generated" | "image_prompt" | "example_image_prompt"
>;
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
  sentence: p.example.sentence,
  translation_vi: p.example.translation_vi,
  translation_en: p.example.translation_en,
  translation_ko: p.example.translation_ko,
  ai_generated: true,
  image_prompt: p.image_prompt,
  example_image_prompt: p.example.image_prompt,
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
  image_prompt: null,
  example_image_prompt: null,
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
    image_prompt: p.image_prompt,
    example_image_prompt: ex?.image_prompt ?? null,
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
    image_prompt: d.image_prompt,
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
            image_prompt: d.example_image_prompt,
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
