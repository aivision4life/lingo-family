import { z } from "zod";
import { exampleLevelSchema, learnLangSchema, type LearnLang } from "./enums";

export const PARTS_OF_SPEECH = [
  "noun", "verb", "adjective", "adverb", "pronoun", "numeral",
  "particle", "conjunction", "interjection", "phrase", "other",
] as const;
export const posSchema = z.enum(PARTS_OF_SPEECH);

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

const termSchema = z.string().transform(normalizeTerm).pipe(z.string().min(1).max(TERM_MAX));

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
  hanzi_simplified: z.string(),
  hanzi_traditional: z.string(),
  han_viet: z.string(),
  emoji: z.string(),
  examples: z
    .array(
      z.object({
        sentence: z.string().min(1),
        translation_vi: z.string(),
        translation_en: z.string(),
        translation_ko: z.string(),
      }),
    )
    .min(2)
    .max(3),
});
export type LlmEnrichment = z.infer<typeof llmEnrichmentSchema>;

/** Enrichment as returned to the client (not-applicable fields are null). */
export const enrichmentSchema = llmEnrichmentSchema.extend({
  hanzi_simplified: z.string().nullable(),
  hanzi_traditional: z.string().nullable(),
  han_viet: z.string().nullable(),
  emoji: z.string().nullable(),
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

const optionalText = z
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
});
export type ExampleInput = z.input<typeof exampleInputSchema>;

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
  hanzi_simplified: optionalText,
  hanzi_traditional: optionalText,
  han_viet: optionalText,
  emoji: optionalText,
  ai_generated: z.boolean(),
  examples: z.array(exampleInputSchema).max(EXAMPLES_MAX),
});
export type WordCreate = z.input<typeof wordCreateSchema>;

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
});

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
});
export type WordSummary = z.infer<typeof wordSummarySchema>;
export const wordListSchema = z.array(wordSummarySchema);

export const wordDetailSchema = wordSummarySchema.extend({
  pos: posSchema,
  hanzi_simplified: z.string().nullable(),
  hanzi_traditional: z.string().nullable(),
  han_viet: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.number(),
  examples: z.array(exampleSchema),
});
export type WordDetail = z.infer<typeof wordDetailSchema>;

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
export const wordCreatedSchema = z.object({ id: z.string(), audio: audioResultSchema });

/** POST /api/words/:id/audio */
export const generateAudioRequestSchema = z.object({ profile_id: z.string().min(1) });
