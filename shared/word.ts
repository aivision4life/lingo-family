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
import { albumRefSchema } from "./album";
import { audioFailureSchema } from "./audioFailure";
import { exampleLevelSchema, learnLangSchema, libraryScopeSchema } from "./enums";
import { TOPIK_SOURCES_MAX, topikWordSourceSchema } from "./topikSource";
import { imageViewSchema } from "./image";
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
  /** English scene description for the word's image (IMAGE_PROMPT_RULES). */
  image_prompt: z.string().min(1),
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

/**
 * Which register the example sentences are written in (M7.12). `general` is everything the app did
 * before — everyday sentences at the profile's level. `topik` is for a word met in a TOPIK II
 * question: the exam's own written register and subject matter, because a learner sitting TOPIK
 * needs to meet the word the way the exam uses it, not over dinner.
 */
export const exampleStyleSchema = z.enum(["general", "topik"]);
export type ExampleStyle = z.infer<typeof exampleStyleSchema>;

export const enrichRequestSchema = z.object({
  profile_id: z.string().min(1),
  lang: learnLangSchema,
  term: termSchema,
  level: exampleLevelSchema,
  style: exampleStyleSchema.default("general"),
});
export type EnrichRequest = z.input<typeof enrichRequestSchema>;

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
  /** From enrichment; null for words typed by hand (then no image is drawn automatically). */
  image_prompt: optionalText.optional().default(null),
  ai_generated: z.boolean(),
  examples: z.array(exampleInputSchema).max(EXAMPLES_MAX),
  /** Ticked phrases saved together with the word (duplicates are skipped). */
  phrases: z.array(phraseInputSchema).max(PHRASES_MAX).default([]),
  /** Albums (of the word's language) the new word is added to (M2.4). */
  album_ids: z.array(z.string().min(1)).max(50).default([]),
  /** Where the word was met, when it came from a TOPIK question (M7.12). */
  topik_sources: z.array(topikWordSourceSchema).max(TOPIK_SOURCES_MAX).default([]),
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
}).extend(imageViewSchema.shape);
export type WordSummary = z.infer<typeof wordSummarySchema>;
export const wordListSchema = z.array(wordSummarySchema);

export const wordDetailSchema = wordSummarySchema.extend({
  pos: posSchema,
  hanja: z.string().nullable(),
  han_viet: z.string().nullable(),
  notes: z.string().nullable(),
  /** TOPIK questions this word was met in (M7.12), oldest first. */
  topik_sources: z.array(topikWordSourceSchema),
  created_at: z.number(),
  /** Examples of the word itself (phrase examples are inside `phrases`). */
  examples: z.array(exampleSchema),
  phrases: z.array(phraseSchema),
  /** Review cards of all profiles for this word and its phrases (shown before deleting). */
  card_count: z.number().int().nonnegative(),
  /** Albums the word is in (M2.4). */
  albums: z.array(albumRefSchema),
});
export type WordDetail = z.infer<typeof wordDetailSchema>;

/** DELETE /api/words/:id (adults only). */
export const deleteWordRequestSchema = z.object({ profile_id: z.string().min(1) });

export const wordListQuerySchema = z
  .object({
    lang: learnLangSchema.optional(),
    q: z.string().trim().max(TERM_MAX).optional(),
    /** An album id, or "none" for words that are in no album (the virtual "Unsorted" entry). */
    album: z.string().min(1).optional(),
    /** Library filter (M2.7): "learning" (has a card), "mine" (I added it), or "all" (default). */
    scope: libraryScopeSchema.default("all"),
    /** Required when scope is not "all". */
    profile_id: z.string().min(1).optional(),
  })
  .refine((v) => v.scope === "all" || !!v.profile_id, { message: "profile_id is required for this scope", path: ["profile_id"] });

export const WORD_ERRORS = {
  /** Same language + term already exists; body has `existing_id`. */
  duplicate: "duplicate_word",
  kidForbidden: "kid_forbidden",
  quotaExceeded: "quota_exceeded",
  aiNotConfigured: "ai_not_configured",
  /** The AI is busy (after retries and the fallback model): try again later. */
  aiUnavailable: "ai_unavailable",
  /** The AI provider refused the request (key / model / request problem): retrying will not help. */
  aiRejected: "ai_rejected",
  aiInvalidOutput: "ai_invalid_output",
  ttsNotConfigured: "tts_not_configured",
} as const;

export const duplicateErrorSchema = z.object({
  error: z.literal(WORD_ERRORS.duplicate),
  existing_id: z.string(),
});

/** GET /api/words/lookup?lang=&term= (M6.2): whether a word already exists, and its own gloss if so. */
export const wordLookupRequestSchema = z.object({ lang: learnLangSchema, term: z.string().trim().min(1) });
export const wordLookupResponseSchema = z.object({ id: z.string(), gloss_vi: z.string() }).nullable();

/** Daily LLM calls per profile (SPEC F6). Cache hits do not count. */
export const LLM_DAILY_QUOTA = 50;

/** Daily Azure TTS calls per profile (SPEC F3). Files already in R2 do not count. */
export const TTS_DAILY_QUOTA = 200;

/** Result of generating audio for a word: how many items (word + examples) still lack audio. */
export const audioResultSchema = z.object({
  missing: z.number().int().nonnegative(),
  /** Why they are still missing, so the screen can say which of three very different things went
   * wrong (M7.13). Null when nothing failed. */
  reason: audioFailureSchema.nullable().default(null),
});

/** POST /api/words response. */
export const wordCreatedSchema = z.object({
  id: z.string(),
  audio: audioResultSchema,
  /** Ticked phrases not saved because they already exist (SPEC: shown as "already under word X"). */
  skipped_phrases: z.array(skippedPhraseSchema),
  /** False when the word's language is not in the creator's study_langs (M2.7): no card was made for them. */
  added_to_learning: z.boolean(),
});

/** POST /api/words/:id/audio */
export const generateAudioRequestSchema = z.object({ profile_id: z.string().min(1) });
