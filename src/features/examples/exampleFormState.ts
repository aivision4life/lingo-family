// State and rules of the example-sentence form (add / edit), M2.6. Pure functions, unit tested.
import type { SentenceFields } from "@shared/customItem";
import type { LearnLang } from "@shared/enums";
import { normalizeTerm } from "@shared/base";
import { sentenceChanged, type ExampleCreate, type ExamplePatch } from "@shared/exampleEdit";

export type ExampleFormState = {
  sentence: string;
  translation_vi: string;
  translation_en: string;
  translation_ko: string;
  /** English scene for the picture; "" = none. */
  image_prompt: string;
  /** The translations / prompt came from the AI help. */
  ai_generated: boolean;
  /** The sentence text the AI help was last run for (null = never). */
  aiForText: string | null;
  /** Edit form: "Update meaning & picture with AI". */
  refresh: boolean;
};

type ExampleLike = {
  sentence: string;
  translation_vi: string;
  translation_en: string;
  translation_ko: string;
  image_prompt: string | null;
  ai_generated: boolean;
};

export const emptyForm = (): ExampleFormState => ({
  sentence: "",
  translation_vi: "",
  translation_en: "",
  translation_ko: "",
  image_prompt: "",
  ai_generated: false,
  aiForText: null,
  refresh: false,
});

export const formFromExample = (ex: ExampleLike): ExampleFormState => ({
  sentence: ex.sentence,
  translation_vi: ex.translation_vi,
  translation_en: ex.translation_en,
  translation_ko: ex.translation_ko,
  image_prompt: ex.image_prompt ?? "",
  ai_generated: ex.ai_generated,
  aiForText: null,
  refresh: false,
});

/** Applies the AI's fields (the checked sentence, or the suggested one) to the form. */
export const applyFields = (s: ExampleFormState, f: SentenceFields): ExampleFormState => ({
  ...s,
  sentence: f.text,
  translation_vi: f.translation_vi,
  translation_en: f.translation_en,
  translation_ko: f.translation_ko,
  image_prompt: f.image_prompt,
  ai_generated: true,
  aiForText: normalizeTerm(f.text),
});

/** Sets the sentence text; "Update with AI" is on by default as soon as the content changes. */
export function withSentence(s: ExampleFormState, text: string, original: string | null): ExampleFormState {
  const changed = original !== null && sentenceChanged(original, text);
  const wasChanged = original !== null && sentenceChanged(original, s.sentence);
  return { ...s, sentence: text, refresh: changed && !wasChanged ? true : changed ? s.refresh : false };
}

/**
 * Edit form, "Save" pressed: with "Update with AI" on and a changed sentence, the first press runs
 * the AI help (the user reviews the result); only then does Save store the example.
 */
export const editNeedsAiStep = (s: ExampleFormState, original: string) =>
  s.refresh && sentenceChanged(original, s.sentence) && s.aiForText !== normalizeTerm(s.sentence);

/**
 * PATCH body. Only the translations → no sentence, no prompt, no redraw (the server then neither
 * makes audio nor draws). A changed sentence is sent; with "Update with AI" the prompt is sent too
 * and the picture is redrawn.
 */
export function buildPatch(s: ExampleFormState, original: ExampleLike, lang: LearnLang, profileId: string): ExamplePatch {
  const textChanged = sentenceChanged(original.sentence, s.sentence);
  const redraw = s.refresh && textChanged && s.image_prompt.trim().length >= 10;
  return {
    profile_id: profileId,
    ...(textChanged ? { sentence: s.sentence } : {}),
    translation_vi: s.translation_vi,
    ...(lang === "en" ? {} : { translation_en: s.translation_en }),
    ...(lang === "ko" ? {} : { translation_ko: s.translation_ko }),
    ...(redraw ? { image_prompt: s.image_prompt.trim(), redraw_image: true, ai_generated: true } : {}),
  };
}

export function buildCreate(s: ExampleFormState, lang: LearnLang, profileId: string, phraseId: string | null): ExampleCreate {
  const prompt = s.image_prompt.trim();
  return {
    profile_id: profileId,
    sentence: s.sentence,
    translation_vi: s.translation_vi,
    translation_en: lang === "en" ? "" : s.translation_en,
    translation_ko: lang === "ko" ? "" : s.translation_ko,
    image_prompt: prompt.length >= 10 ? prompt : null,
    ai_generated: s.ai_generated,
    phrase_id: phraseId,
  };
}

/**
 * Light warning: the sentence seems not to contain the root word. The text itself is the quick
 * check (exact match); otherwise the AI's judgement decides (it knows inflected forms).
 */
export const showContainsWarning = (text: string, rootTerm: string, aiContainsWord: boolean | null): boolean =>
  rootTerm !== "" && !text.includes(rootTerm) && aiContainsWord === false;
