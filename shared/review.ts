// API contract for /api/review.
import { z } from "zod";
import { exampleSchema } from "./base";
import { cardTypeSchema, imageStatusSchema, learnLangSchema } from "./enums";
import type { CardFields } from "./scheduling";

/** Header the client sends with a fake "now"; honoured only when DEV_TIME_TRAVEL=1. */
export const DEV_NOW_HEADER = "X-Dev-Now";

/** Card as sent over JSON (dates as epoch ms). */
export const cardDtoSchema = z.object({
  id: z.string(),
  card_type: cardTypeSchema,
  due: z.number(),
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  learning_steps: z.number(),
  reps: z.number(),
  lapses: z.number(),
  state: z.number().int().min(0).max(3),
  last_review: z.number().nullable(),
});
export type CardDto = z.infer<typeof cardDtoSchema>;

export const cardFieldsFromDto = (c: CardDto): CardFields => ({
  ...c,
  due: new Date(c.due),
  last_review: c.last_review === null ? null : new Date(c.last_review),
});

/** The item a card belongs to: a word, or a phrase (then `root_term` is its root word). */
export const reviewWordSchema = z.object({
  kind: z.enum(["word", "phrase"]),
  /** Word id, or phrase id for a phrase card. */
  id: z.string(),
  /** Id of the word, or of the phrase's root word (for links to Word detail). */
  word_id: z.string(),
  root_term: z.string().nullable(),
  lang: learnLangSchema,
  term: z.string(),
  reading: z.string(),
  gloss_vi: z.string(),
  gloss_en: z.string(),
  gloss_ko: z.string(),
  emoji: z.string().nullable(),
  hanja: z.string().nullable(),
  han_viet: z.string().nullable(),
  audio_key: z.string().nullable(),
  /** Image of the word / phrase (shown large on the back of the card). */
  image_key: z.string().nullable(),
  image_status: imageStatusSchema,
});

/** Example sentences of the item (shown on the back, each with a small image and audio). */
export const queueItemSchema = z.object({
  card: cardDtoSchema,
  word: reviewWordSchema,
  examples: z.array(exampleSchema),
});
export type QueueItem = z.infer<typeof queueItemSchema>;

export const queueResponseSchema = z.object({ items: z.array(queueItemSchema), now: z.number() });

/** `tz` = minutes east of UTC (= -Date.getTimezoneOffset()). */
const tzSchema = z.coerce.number().int().min(-14 * 60).max(14 * 60);

export const summaryQuerySchema = z.object({ profile_id: z.string().min(1), tz: tzSchema });
export const queueQuerySchema = summaryQuerySchema.extend({ lang: learnLangSchema });

/** Cards to study today (due + new) by type: text = recognition, picture, listening. */
export const typeCountsSchema = z.object({
  recognition: z.number().int(),
  picture: z.number().int(),
  listening: z.number().int(),
});
export type TypeCounts = z.infer<typeof typeCountsSchema>;

export const summarySchema = z.array(
  z.object({ lang: learnLangSchema, due: z.number().int(), new: z.number().int(), by_type: typeCountsSchema }),
);
export type ReviewSummary = z.infer<typeof summarySchema>;

export const answerRequestSchema = z.object({
  profile_id: z.string().min(1),
  card_id: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  duration_ms: z.number().int().min(0).max(60 * 60 * 1000).nullable(),
});
export type AnswerRequest = z.infer<typeof answerRequestSchema>;

export const answerResponseSchema = z.object({ card: cardDtoSchema });
