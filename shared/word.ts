import { z } from "zod";
import {
  EXAMPLES_MAX,
  exampleInputSchema,
  exampleSchema,
  llmSentenceSchema,
  optionalText,
  TERM_MAX,
  termSchema,
} from "./base";
import { exampleLevelSchema, learnLangSchema } from "./enums";
import { llmPhraseSchema, PHRASES_MAX, phraseInputSchema, phraseSchema, skippedPhraseSchema } from "./phrase";

// Base text/example schemas live in ./base (shared with ./phrase); re-exported for existing imports.
export {
  duplicateKey,
  EXAMPLES_MAX,
  exampleInputSchema,
  exampleSchema,
  normalizeTerm,
  TERM_MAX,
  type ExampleInput,
} from "./base";

export const PARTS_OF_SPEECH = [
  "noun", "verb", "adjective", "adverb", "pronoun", "numeral",
  "particle", "conjunction", "interjection", "phrase", "other",
] as const;
export const posSchema = z.enum(PARTS_OF_SPEECH);



// --- AI enrichment -----------------------------------------------------------

/**
 * What the LLM must return (strict JSON). Not-applicable fields are "" (simpler for the
 * model than null); the server converts them to null. See SPEC F6 for field conventions.
 */
export const llmEnrichmentSchema = z.object({
  reading: z.string().min(1),
  pos: posSchema,
  gloss_vi: z.string().min(1),
  gloss_en: z.string().min(1),
  gloss_ko: z.string().min(1),
  hanja: z.string(),
  han_viet: z.string(),
  emoji: z.string(),
  // SPEC: 2 examples per word (a 3rd one is tolerated and dropped by the server).
  examples: z.array(llmSentenceSchema).min(2).max(3),
  phrases: z.array(llmPhraseSchema).min(1).max(PHRASES_MAX),
});
export type LlmEnrichment = z.infer<typeof llmEnrichmentSchema>;

/** Enrichment as returned to the client (not-applicable fields are null). */
export const enrichmentSchema = llmEnrichmentSchema.extend({
  hanja: z.string().nullable(),
  han_viet: z.string().nullable(),
  emoji: z.string().nullable(),
  /** Suggested phrases; the adult ticks which ones to save (SPEC F2). */
  phrases: z.array(llmPhraseSchema).max(PHRASES_MAX),
});
export type Enrichment = z.infer<typeof enrichmentSchema>;

export const enrichRequestSchema = z.object({
  profile_id: z.string().min(1),
  lang: learnLangSchema,
  term: termSchema,
  level: exampleLevelSchema,
});
export type EnrichRequest = z.infer<typeof enrichRequestSchema>;

export const enrichResponseSchema = z.object({
  enrichment: enrichmentSchema,
  /** True when served from ai_cache (no LLM call, no quota used). */
  cached: z.boolean(),
});

// --- Words -------------------------------------------------------------------



/** POST /api/words */
export const wordCreateSchema = z.object({
  profile_id: z.string().min(1),
  lang: learnLangSchema,
  term: termSchema,
  reading: z.string().trim().min(1),
  pos: posSchema,
  gloss_vi: z.string().trim().min(1),
  gloss_en: z.string().trim().min(1),
  gloss_ko: z.string().trim().min(1),
  hanja: optionalText,
  han_viet: optionalText,
  emoji: optionalText,
  ai_generated: z.boolean(),
  examples: z.array(exampleInputSchema).max(EXAMPLES_MAX),
  /** Ticked phrases saved together with the word (duplicates are skipped). */
  phrases: z.array(phraseInputSchema).max(PHRASES_MAX).default([]),
});
export type WordCreate = z.input<typeof wordCreateSchema>;

export const wordSummarySchema = z.object({
  id: z.string(),
  lang: learnLangSchema,
  term: z.string(),
  reading: z.string(),
  gloss_vi: z.string(),
  gloss_en: z.string(),
  gloss_ko: z.string(),
  emoji: z.string().nullable(),
  /** R2 key of the word audio; null until generated. Play via `/api/media/{audio_key}`. */
  audio_key: z.string().nullable(),
  ai_generated: z.boolean(),
  verified: z.boolean(),
  /** Number of phrases built on this word. */
  phrase_count: z.number().int().nonnegative(),
});
export type WordSummary = z.infer<typeof wordSummarySchema>;
export const wordListSchema = z.array(wordSummarySchema);

export const wordDetailSchema = wordSummarySchema.extend({
  pos: posSchema,
  hanja: z.string().nullable(),
  han_viet: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.number(),
  /** Examples of the word itself (phrase examples are inside `phrases`). */
  examples: z.array(exampleSchema),
  phrases: z.array(phraseSchema),
  /** Review cards of all profiles for this word and its phrases (shown before deleting). */
  card_count: z.number().int().nonnegative(),
});
export type WordDetail = z.infer<typeof wordDetailSchema>;

/** DELETE /api/words/:id (adults only). */
export const deleteWordRequestSchema = z.object({ profile_id: z.string().min(1) });

export const wordListQuerySchema = z.object({
  lang: learnLangSchema.optional(),
  q: z.string().trim().max(TERM_MAX).optional(),
});

export const WORD_ERRORS = {
  /** Same language + term already exists; body has `existing_id`. */
  duplicate: "duplicate_word",
  kidForbidden: "kid_forbidden",
  quotaExceeded: "quota_exceeded",
  aiNotConfigured: "ai_not_configured",
  aiUnavailable: "ai_unavailable",
  aiInvalidOutput: "ai_invalid_output",
  ttsNotConfigured: "tts_not_configured",
} as const;

export const duplicateErrorSchema = z.object({
  error: z.literal(WORD_ERRORS.duplicate),
  existing_id: z.string(),
});

/** Daily LLM calls per profile (SPEC F6). Cache hits do not count. */
export const LLM_DAILY_QUOTA = 50;

/** Daily Azure TTS calls per profile (SPEC F3). Files already in R2 do not count. */
export const TTS_DAILY_QUOTA = 200;

/** Result of generating audio for a word: how many items (word + examples) still lack audio. */
export const audioResultSchema = z.object({ missing: z.number().int().nonnegative() });

/** POST /api/words response. */
export const wordCreatedSchema = z.object({
  id: z.string(),
  audio: audioResultSchema,
  /** Ticked phrases not saved because they already exist (SPEC: shown as "already under word X"). */
  skipped_phrases: z.array(skippedPhraseSchema),
});

/** POST /api/words/:id/audio */
export const generateAudioRequestSchema = z.object({ profile_id: z.string().min(1) });
