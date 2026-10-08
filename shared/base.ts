// Base schemas shared by words and phrases (kept separate to avoid an import cycle).
import { z } from "zod";
import { exampleLevelSchema, type LearnLang } from "./enums";
import { imageViewSchema } from "./image";

export const TERM_MAX = 60;
export const EXAMPLES_MAX = 5;

/**
 * Canonical form used for storage and duplicate checks:
 * Unicode NFC, trimmed, inner whitespace collapsed.
 */
export function normalizeTerm(term: string): string {
  return term.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Key for duplicate detection; English is case-insensitive ("Apple" = "apple"). */
export function duplicateKey(lang: LearnLang, term: string): string {
  const t = normalizeTerm(term);
  return lang === "en" ? t.toLowerCase() : t;
}

export const termSchema = z.string().transform(normalizeTerm).pipe(z.string().min(1).max(TERM_MAX));

/** Nullable text input: blank → null, otherwise trimmed. */
export const optionalText = z
  .string()
  .nullable()
  .transform((s) => (s === null || s.trim() === "" ? null : s.trim()));

export const exampleInputSchema = z.object({
  sentence: z.string().trim().min(1),
  translation_vi: z.string().trim(),
  translation_en: z.string().trim(),
  translation_ko: z.string().trim(),
  level: exampleLevelSchema,
  ai_generated: z.boolean(),
  /** Scene for the example's image (from enrichment); drawn lazily when first displayed. */
  image_prompt: optionalText.optional().default(null),
});
export type ExampleInput = z.input<typeof exampleInputSchema>;

/** One example sentence as returned by the LLM (translation into its own language is ""). */
export const llmSentenceSchema = z.object({
  sentence: z.string().min(1),
  translation_vi: z.string(),
  translation_en: z.string(),
  translation_ko: z.string(),
  /** English scene description for the sentence's image (IMAGE_PROMPT_RULES). */
  image_prompt: z.string().min(1),
});
export type LlmSentence = z.infer<typeof llmSentenceSchema>;

export const exampleSchema = z.object({
  id: z.string(),
  sentence: z.string(),
  translation_vi: z.string(),
  translation_en: z.string(),
  translation_ko: z.string(),
  level: exampleLevelSchema,
  ai_generated: z.boolean(),
  /** R2 key of the sentence audio; null until generated. Play via `/api/media/{audio_key}`. */
  audio_key: z.string().nullable(),
}).extend(imageViewSchema.shape);

