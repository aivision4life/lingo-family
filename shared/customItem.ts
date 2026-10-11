// AI help for sentences and phrases typed by hand (M2.6): translate, write an image prompt and (for
// sentences) check the text. Contract shared by the Worker and the app.
import { z } from "zod";
import { normalizeTerm, termSchema } from "./base";
import { learnLangSchema } from "./enums";

export const SENTENCE_MAX = 200;
export const IMAGE_PROMPT_MAX = 400;

export const sentenceTextSchema = z.string().transform(normalizeTerm).pipe(z.string().min(1).max(SENTENCE_MAX));

const rootWord = {
  /** The root word the item belongs to (also for a word that is not saved yet). */
  word_term: termSchema,
  /** The root word's meaning, to keep the AI on the right sense (may be empty). */
  word_gloss: z.string().trim().max(200).default(""),
};

export const enrichSentenceRequestSchema = z.object({
  profile_id: z.string().min(1),
  lang: learnLangSchema,
  text: sentenceTextSchema,
  ...rootWord,
});
export type EnrichSentenceRequest = z.infer<typeof enrichSentenceRequestSchema>;

export const enrichPhraseRequestSchema = z.object({
  profile_id: z.string().min(1),
  lang: learnLangSchema,
  text: termSchema,
  ...rootWord,
});
export type EnrichPhraseRequest = z.infer<typeof enrichPhraseRequestSchema>;

const imagePrompt = z.string().trim().min(10).max(IMAGE_PROMPT_MAX);

/**
 * What the LLM returns for a sentence (flat, "" = not applicable: simpler for the model than null).
 * A sentence is never translated into its own language, so that translation is "".
 */
export const llmSentenceCheckSchema = z.object({
  translation_vi: z.string(),
  translation_en: z.string(),
  translation_ko: z.string(),
  image_prompt: imagePrompt,
  /** The sentence contains the root word or an inflected form of it. */
  contains_word: z.boolean(),
  /** "" when the sentence is correct and natural; otherwise a better sentence. */
  suggestion: z.string(),
  suggestion_translation_vi: z.string(),
  suggestion_translation_en: z.string(),
  suggestion_translation_ko: z.string(),
  suggestion_image_prompt: z.string(),
  /** Short Vietnamese reason for the suggestion; "" when there is none. */
  note_vi: z.string(),
});
export type LlmSentenceCheck = z.infer<typeof llmSentenceCheckSchema>;

export const sentenceFieldsSchema = z.object({
  text: z.string(),
  translation_vi: z.string(),
  translation_en: z.string(),
  translation_ko: z.string(),
  image_prompt: z.string(),
});
export type SentenceFields = z.infer<typeof sentenceFieldsSchema>;

/** The checked result the app uses (and ai_cache stores). */
export const sentenceCheckSchema = z.object({
  sentence: sentenceFieldsSchema,
  contains_word: z.boolean(),
  /** A better sentence with its own translations and image prompt, or null when the sentence is fine. */
  suggestion: sentenceFieldsSchema.nullable(),
  /** Reason for the suggestion (Vietnamese); null exactly when there is no suggestion. */
  note_vi: z.string().nullable(),
});
export type SentenceCheck = z.infer<typeof sentenceCheckSchema>;

export const enrichSentenceResponseSchema = z.object({ check: sentenceCheckSchema, cached: z.boolean() });

export const llmPhraseFillSchema = z.object({
  reading: z.string().min(1),
  gloss_vi: z.string().min(1),
  gloss_en: z.string().min(1),
  gloss_ko: z.string().min(1),
  image_prompt: imagePrompt,
  contains_word: z.boolean(),
});
export type LlmPhraseFill = z.infer<typeof llmPhraseFillSchema>;

export const phraseFillSchema = llmPhraseFillSchema.extend({ text: z.string() });
export type PhraseFill = z.infer<typeof phraseFillSchema>;
export const enrichPhraseResponseSchema = z.object({ fill: phraseFillSchema, cached: z.boolean() });
