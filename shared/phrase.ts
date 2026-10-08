// Phrases: collocations / short expressions built on one root word (SPEC F2, M1.7).
import { z } from "zod";
import { exampleInputSchema, exampleSchema, llmSentenceSchema, optionalText, termSchema } from "./base";
import { exampleLevelSchema, learnLangSchema } from "./enums";

/** At most 3 phrases are suggested / saved at once (SPEC F2). */
export const PHRASES_MAX = 3;

/** A suggested phrase as returned by the LLM; 1 example per phrase (SPEC F6). */
export const llmPhraseSchema = z.object({
  text: z.string().min(1),
  reading: z.string().min(1),
  gloss_vi: z.string().min(1),
  gloss_en: z.string().min(1),
  gloss_ko: z.string().min(1),
  example: llmSentenceSchema,
});
export type LlmPhrase = z.infer<typeof llmPhraseSchema>;

/** Phrase to save (from an AI suggestion or typed by hand). */
export const phraseInputSchema = z.object({
  text: termSchema,
  reading: z.string().trim().min(1),
  gloss_vi: z.string().trim().min(1),
  gloss_en: z.string().trim().min(1),
  gloss_ko: z.string().trim().min(1),
  emoji: optionalText.optional().default(null),
  ai_generated: z.boolean(),
  /** One example sentence, or null when typed by hand without one. */
  example: exampleInputSchema.nullable(),
});
export type PhraseInput = z.input<typeof phraseInputSchema>;

/** POST /api/words/:id/phrases */
export const savePhrasesRequestSchema = z.object({
  profile_id: z.string().min(1),
  phrases: z.array(phraseInputSchema).min(1).max(PHRASES_MAX),
});

/** A phrase skipped because the same text already exists (possibly under another root word). */
export const skippedPhraseSchema = z.object({ text: z.string(), existing_word_term: z.string() });
export type SkippedPhrase = z.infer<typeof skippedPhraseSchema>;

export const savePhrasesResponseSchema = z.object({
  saved: z.array(z.string()),
  skipped: z.array(skippedPhraseSchema),
  /** Items (phrases + their examples) still without audio. */
  audio: z.object({ missing: z.number().int().nonnegative() }),
});

/** POST /api/words/:id/phrases/suggest */
export const suggestPhrasesRequestSchema = z.object({ profile_id: z.string().min(1), level: exampleLevelSchema });
export const suggestPhrasesResponseSchema = z.object({
  phrases: z.array(llmPhraseSchema).max(PHRASES_MAX),
  cached: z.boolean(),
});
/** What the LLM must return for "suggest phrases" on an existing word. */
export const llmPhraseSuggestionsSchema = z.object({ phrases: z.array(llmPhraseSchema).min(1).max(PHRASES_MAX) });

/** PATCH /api/phrases/:id — every field optional; `example: null` removes the example. */
export const phraseUpdateSchema = z.object({
  profile_id: z.string().min(1),
  text: termSchema.optional(),
  reading: z.string().trim().min(1).optional(),
  gloss_vi: z.string().trim().min(1).optional(),
  gloss_en: z.string().trim().min(1).optional(),
  gloss_ko: z.string().trim().min(1).optional(),
  example: exampleInputSchema.nullable().optional(),
});
export type PhraseUpdate = z.input<typeof phraseUpdateSchema>;

/** A phrase as sent to the client (Word detail). */
export const phraseSchema = z.object({
  id: z.string(),
  word_id: z.string(),
  lang: learnLangSchema,
  text: z.string(),
  reading: z.string(),
  gloss_vi: z.string(),
  gloss_en: z.string(),
  gloss_ko: z.string(),
  emoji: z.string().nullable(),
  audio_key: z.string().nullable(),
  ai_generated: z.boolean(),
  verified: z.boolean(),
  examples: z.array(exampleSchema),
});
export type Phrase = z.infer<typeof phraseSchema>;

/** A phrase row in the library (GET /api/phrases). */
export const phraseSummarySchema = phraseSchema.omit({ examples: true }).extend({ root_term: z.string() });
export type PhraseSummary = z.infer<typeof phraseSummarySchema>;
export const phraseListSchema = z.array(phraseSummarySchema);

export const PHRASE_ERRORS = {
  /** Same language + text already exists (409 on PATCH). */
  duplicate: "duplicate_phrase",
} as const;
