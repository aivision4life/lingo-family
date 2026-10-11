// Adding, editing and deleting example sentences of saved words and phrases (M2.6).
import { z } from "zod";
import { normalizeTerm } from "./base";
import { exampleLevelSchema, type LearnLang } from "./enums";
import { IMAGE_PROMPT_MAX, SENTENCE_MAX, sentenceTextSchema } from "./customItem";

/** Examples of a word itself; a phrase has at most 1 (SPEC F2, M2.6). */
export const WORD_EXAMPLES_MAX = 5;
export const PHRASE_EXAMPLES_MAX = 1;

const profileId = z.string().min(1);
const translation = z.string().trim().max(SENTENCE_MAX * 2);
const prompt = z.string().trim().min(10).max(IMAGE_PROMPT_MAX);

/** POST /api/words/:id/examples */
export const exampleCreateSchema = z.object({
  profile_id: profileId,
  sentence: sentenceTextSchema,
  translation_vi: translation.default(""),
  translation_en: translation.default(""),
  translation_ko: translation.default(""),
  /** Scene for the picture (from the AI help, possibly edited); without it the picture is drawn lazily. */
  image_prompt: prompt.nullable().default(null),
  level: exampleLevelSchema.default("beginner"),
  /** The translations / prompt came from the AI help. */
  ai_generated: z.boolean().default(false),
  /** Set to add the sentence to one of the word's phrases instead of the word itself. */
  phrase_id: z.string().min(1).nullable().default(null),
});
export type ExampleCreate = z.input<typeof exampleCreateSchema>;

/** PATCH /api/examples/:id — send only what changes. */
export const examplePatchSchema = z.object({
  profile_id: profileId,
  sentence: sentenceTextSchema.optional(),
  translation_vi: translation.optional(),
  translation_en: translation.optional(),
  translation_ko: translation.optional(),
  image_prompt: prompt.nullable().optional(),
  ai_generated: z.boolean().optional(),
  /** Draw a new picture from `image_prompt` (new nonce; the old picture stays in R2). */
  redraw_image: z.boolean().default(false),
});
export type ExamplePatch = z.input<typeof examplePatchSchema>;

export const exampleDeleteSchema = z.object({ profile_id: profileId });

export const exampleSavedSchema = z.object({ id: z.string(), audio: z.object({ missing: z.number().int().nonnegative() }) });

export const EXAMPLE_ERRORS = {
  /** The word / phrase already has the maximum number of examples. */
  tooMany: "too_many_examples",
  /** The same sentence already exists for this word / phrase. */
  duplicate: "duplicate_example",
} as const;

/** The sentence's text changed (so its audio must be made again). Whitespace and Unicode form do not count. */
export const sentenceChanged = (before: string, after: string) => normalizeTerm(before) !== normalizeTerm(after);

/** A sentence is never translated into its own language. */
export function withoutOwnTranslation<T extends { translation_vi?: string; translation_en?: string; translation_ko?: string }>(lang: LearnLang, t: T): T {
  return { ...t, ...(lang === "ko" ? { translation_ko: "" } : { translation_en: "" }) };
}
