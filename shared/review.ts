// API contract for /api/review.
import { z } from "zod";
import { exampleSchema } from "./base";
import { cardTypeSchema, imageStatusSchema, learnLangSchema } from "./enums";
import { SPEAKING_MAX_TAKES } from "./speaking";
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

/**
 * Why speaking cards were left out of this queue although the profile practises them (M3.3):
 * "quota" = no pronunciation scoring left today (this profile's tier, or the family cap). Never a
 * reason to rate anything Again — the cards simply wait for tomorrow.
 */
export const SPEAKING_BLOCKED = ["quota"] as const;
export const speakingBlockedSchema = z.enum(SPEAKING_BLOCKED).nullable();
export type SpeakingBlocked = z.infer<typeof speakingBlockedSchema>;

export const queueResponseSchema = z.object({
  items: z.array(queueItemSchema),
  now: z.number(),
  speaking_blocked: speakingBlockedSchema.default(null),
});

/** `tz` = minutes east of UTC (= -Date.getTimezoneOffset()). */
const tzSchema = z.coerce.number().int().min(-14 * 60).max(14 * 60);

export const summaryQuerySchema = z.object({ profile_id: z.string().min(1), tz: tzSchema });
/** `album` = an album id: only that album's cards are queued (the schedule and daily limit stay per language). */
export const queueQuerySchema = summaryQuerySchema.extend({ lang: learnLangSchema, album: z.string().min(1).optional() });

/** Cards to study today (due + new) by type: text = recognition, picture, listening, speaking. */
export const typeCountsSchema = z.object({
  recognition: z.number().int(),
  picture: z.number().int(),
  listening: z.number().int(),
  speaking: z.number().int(),
});
export type TypeCounts = z.infer<typeof typeCountsSchema>;

/** Due + new cards of one album (Home, M2.4). */
export const albumCountsSchema = z.object({ id: z.string(), name: z.string(), due: z.number().int(), new: z.number().int() });
export type AlbumCounts = z.infer<typeof albumCountsSchema>;

export const summarySchema = z.array(
  z.object({
    lang: learnLangSchema,
    due: z.number().int(),
    new: z.number().int(),
    by_type: typeCountsSchema,
    /** Albums of this language that have words, with their own counts. */
    albums: z.array(albumCountsSchema),
  }),
);
export type ReviewSummary = z.infer<typeof summarySchema>;

export const answerRequestSchema = z
  .object({
    profile_id: z.string().min(1),
    card_id: z.string().min(1),
    /**
     * The rating the learner chose. Absent only on a speaking card the server is asked to grade
     * from `attempt_ids`; a rating sent by hand always wins, on a speaking card too.
     */
    rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    /**
     * Speaking cards (M3.3): the `pron_attempts` rows recorded on this card. The client sends ids,
     * never scores — the server reads back the scores it stored itself and grades them
     * (`shared/speaking.ts`), which is the M7.24 rule: only the server may say what a turn was worth.
     */
    attempt_ids: z.array(z.string().min(1)).max(SPEAKING_MAX_TAKES).optional(),
    duration_ms: z.number().int().min(0).max(60 * 60 * 1000).nullable(),
  })
  .refine((a) => a.rating !== undefined || (a.attempt_ids?.length ?? 0) > 0, {
    message: "rating or attempt_ids is required",
    path: ["rating"],
  });
export type AnswerRequest = z.infer<typeof answerRequestSchema>;

export const answerResponseSchema = z.object({
  card: cardDtoSchema,
  /**
   * False = the card was **not** reviewed: no `review_logs` row, no FSRS change, same schedule
   * (M3.3 — a speaking card whose takes could not be scored is skipped, never rated Again).
   */
  counted: z.boolean(),
  /** The rating that was applied, or null when nothing was counted. */
  rating: z.number().int().nullable(),
});
