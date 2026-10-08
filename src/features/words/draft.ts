// Editable draft of a new word (strings while editing), and conversion to the API input.
import type { ExampleLevel, LearnLang } from "@shared/enums";
import { wordCreateSchema, type Enrichment, type WordCreate } from "@shared/word";

export type ExampleDraft = {
  /** Local key for React lists. */
  key: string;
  sentence: string;
  translation_vi: string;
  translation_en: string;
  translation_ko: string;
  ai_generated: boolean;
  /** From enrichment (not shown in the form); the sentence image is drawn lazily from it. */
  image_prompt: string | null;
};

export type WordDraft = {
  reading: string;
  pos: WordCreate["pos"];
  gloss_vi: string;
  gloss_en: string;
  gloss_ko: string;
  hanja: string;
  han_viet: string;
  emoji: string;
  /** From enrichment (not shown in the form; editable later with "Redraw"). */
  image_prompt: string | null;
  examples: ExampleDraft[];
};

export type DraftTextField = Exclude<keyof WordDraft, "pos" | "examples" | "image_prompt">;

/** Field path → true, e.g. "gloss_vi" or "examples.0.sentence". */
export type DraftErrors = Record<string, true>;

let keySeq = 0;
const newKey = () => `ex-${++keySeq}`;

export const emptyExample = (): ExampleDraft => ({
  key: newKey(),
  sentence: "",
  translation_vi: "",
  translation_en: "",
  translation_ko: "",
  ai_generated: false,
  image_prompt: null,
});

export const emptyDraft = (): WordDraft => ({
  reading: "",
  pos: "noun",
  gloss_vi: "",
  gloss_en: "",
  gloss_ko: "",
  hanja: "",
  han_viet: "",
  emoji: "",
  image_prompt: null,
  examples: [emptyExample()],
});

export function draftFromEnrichment(e: Enrichment): WordDraft {
  return {
    reading: e.reading,
    pos: e.pos,
    gloss_vi: e.gloss_vi,
    gloss_en: e.gloss_en,
    gloss_ko: e.gloss_ko,
    hanja: e.hanja ?? "",
    han_viet: e.han_viet ?? "",
    emoji: e.emoji ?? "",
    image_prompt: e.image_prompt,
    examples: e.examples.map((ex) => ({ ...ex, key: newKey(), ai_generated: true })),
  };
}

/** Hanja fields only apply to Korean words. */
export const hanFieldsFor = (lang: LearnLang): DraftTextField[] => (lang === "ko" ? ["hanja", "han_viet"] : []);

type Meta = { profileId: string; lang: LearnLang; term: string; level: ExampleLevel; aiFilled: boolean };

export function draftToCreateInput(
  d: WordDraft,
  m: Meta,
): { input: WordCreate; errors: null } | { input: null; errors: DraftErrors } {
  const han = hanFieldsFor(m.lang);
  const pick = (f: DraftTextField) => (han.includes(f) ? d[f] : null);

  const input: WordCreate = {
    profile_id: m.profileId,
    lang: m.lang,
    term: m.term,
    reading: d.reading,
    pos: d.pos,
    gloss_vi: d.gloss_vi,
    gloss_en: d.gloss_en,
    gloss_ko: d.gloss_ko,
    hanja: pick("hanja"),
    han_viet: pick("han_viet"),
    emoji: d.emoji,
    image_prompt: d.image_prompt,
    ai_generated: m.aiFilled,
    // Blank example rows are dropped instead of failing validation.
    examples: d.examples
      .filter((ex) => ex.sentence.trim() !== "")
      .map(({ key: _key, ...ex }) => ({ ...ex, level: m.level })),
  };

  const result = wordCreateSchema.safeParse(input);
  if (result.success) return { input, errors: null };
  const errors: DraftErrors = {};
  for (const issue of result.error.issues) errors[issue.path.join(".")] = true;
  return { input: null, errors };
}
