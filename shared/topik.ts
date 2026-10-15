// TOPIK II practice (SPEC F12, M6.1; per-question vocabulary M6.2): question bank, import,
// practice sessions and the "tap a word" vocabulary AI adds to each question.
import { z } from "zod";
import { topikSectionSchema } from "./enums";
import { posSchema } from "./word";

export const TOPIK_OPTION_COUNT = 4;

/** Looser than the general upload limits (SPEC F3): exam scans need to stay legible. */
export const TOPIK_IMAGE_MAX_SIDE = 1600;
export const TOPIK_IMAGE_MAX_BYTES = 1_000_000;

/** A stem or one option: text and/or an image (R2 key, content-addressed like other uploads). */
export const topikContentSchema = z
  .object({
    text: z.string().trim().nullable(),
    image_key: z.string().nullable(),
  })
  .refine((c) => c.text !== null || c.image_key !== null, { message: "topik_content_empty", path: ["text"] });
export type TopikContent = z.infer<typeof topikContentSchema>;

export const topikOptionsSchema = z.tuple([topikContentSchema, topikContentSchema, topikContentSchema, topikContentSchema]);
export type TopikOptions = z.infer<typeof topikOptionsSchema>;

export const topikCorrectOptionSchema = z.number().int().min(1).max(TOPIK_OPTION_COUNT);

/**
 * One tappable word found in a question's text (M6.2): `surface` is the exact inflected form as it
 * appears in the text (needed to match where the learner tapped — Korean attaches grammar endings
 * without a space), `lemma` is the dictionary form. Generated once by AI (never at practice time)
 * and stored on the question; `pos` reuses the same part-of-speech set as the word library so a
 * tapped entry can be handed straight to the normal "add word" flow.
 */
export const topikVocabEntrySchema = z.object({
  surface: z.string().trim().min(1),
  lemma: z.string().trim().min(1),
  pos: posSchema,
  gloss_vi: z.string().trim().min(1),
});
export type TopikVocabEntry = z.infer<typeof topikVocabEntrySchema>;
export const topikVocabListSchema = z.array(topikVocabEntrySchema);

const commonFields = {
  section: topikSectionSchema,
  /** Free-form label, e.g. "Yonsei/연습1" or "8DeOfficial/연습3 (37회)". */
  exam: z.string().trim().min(1).max(200),
  /** The real TOPIK question number (not a position within the exam). */
  number: z.number().int().positive(),
  /** Explicit question-number block this item belongs to, e.g. "1~2" or "9" (never derived from `instruction`). */
  block: z.string().trim().min(1).max(20),
  instruction: z.string().trim().nullable(),
  stem: topikContentSchema,
  options: topikOptionsSchema,
};

/** A question as entered/edited by an adult (manual form, import, PATCH body). */
export const topikQuestionInputSchema = z.object({ ...commonFields, correct_option: topikCorrectOptionSchema });
export type TopikQuestionInput = z.infer<typeof topikQuestionInputSchema>;

/** Every field optional (PATCH); `verified` lets the review screen approve without editing anything else. */
export const topikQuestionUpdateSchema = z.object({ ...commonFields, correct_option: topikCorrectOptionSchema }).partial().extend({
  verified: z.boolean().optional(),
  /** Review screen clears it (sets "") once the row has been looked at; null keeps it unchanged. */
  warning: z.string().nullable().optional(),
});
export type TopikQuestionUpdate = z.infer<typeof topikQuestionUpdateSchema>;

/** Full question (admin / review view: includes the answer). */
export const topikQuestionSchema = topikQuestionInputSchema.extend({
  id: z.string(),
  /** false for a freshly imported question until an adult reviews and saves it (M6.1). */
  verified: z.boolean(),
  /** Set by the import script when something had to be cross-checked/guessed; null otherwise. */
  warning: z.string().nullable(),
  /** Tappable words found in the question's text (M6.2); [] once generated with nothing to show
   * (e.g. an image-only question), until then also []. */
  vocab: topikVocabListSchema,
  created_by_profile: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type TopikQuestion = z.infer<typeof topikQuestionSchema>;
export const topikQuestionListSchema = z.array(topikQuestionSchema);

/** Question as sent for practice: never carries the answer. `vocab` is safe to include (no spoiler). */
export const topikPracticeQuestionSchema = z.object({ ...commonFields, id: z.string(), vocab: topikVocabListSchema });
export type TopikPracticeQuestion = z.infer<typeof topikPracticeQuestionSchema>;

/** One contiguous run of question numbers sharing the same instruction (for the block picker). */
export const topikBlockSchema = z.object({
  section: topikSectionSchema,
  block: z.string(),
  from: z.number().int(),
  to: z.number().int(),
  /** How many verified questions exist in this range (may cover more than one `block` label). */
  count: z.number().int().nonnegative(),
});
export type TopikBlock = z.infer<typeof topikBlockSchema>;
export const topikBlockListSchema = z.array(topikBlockSchema);

export const TOPIK_SESSION_SIZE = 10;

export const topikSessionRequestSchema = z
  .object({
    profile_id: z.string().min(1),
    section: topikSectionSchema,
    // Query-string values, so coerce (always strings on the wire).
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive(),
  })
  .refine((r) => r.to >= r.from, { message: "topik_range_invalid", path: ["to"] });
export type TopikSessionRequest = z.infer<typeof topikSessionRequestSchema>;
export const topikSessionResponseSchema = z.object({ questions: z.array(topikPracticeQuestionSchema) });

export const topikAttemptRequestSchema = z.object({
  profile_id: z.string().min(1),
  question_id: z.string().min(1),
  selected_option: topikCorrectOptionSchema,
  /** Time from first seeing the question to choosing an answer. */
  duration_ms: z.number().int().nonnegative().nullable().optional(),
});
export type TopikAttemptRequest = z.infer<typeof topikAttemptRequestSchema>;

export const topikAttemptResultSchema = z.object({
  is_correct: z.boolean(),
  correct_option: topikCorrectOptionSchema,
});
export type TopikAttemptResult = z.infer<typeof topikAttemptResultSchema>;

/** Approves every question matching a filter without changing their content (the review screen's "approve group"). */
export const topikVerifyBulkRequestSchema = z.union([
  z.object({ exam: z.string().min(1) }),
  z.object({ section: topikSectionSchema, from: z.number().int().positive(), to: z.number().int().positive() }),
]);
export type TopikVerifyBulkRequest = z.infer<typeof topikVerifyBulkRequestSchema>;

export const topikVerifyBulkResponseSchema = z.object({ verified: z.number().int().nonnegative() });

/** POST /api/topik/questions/upload-image */
export const topikImageUploadResponseSchema = z.object({ image_key: z.string() });

export const TOPIK_ERRORS = {
  /** (section, exam, number) already exists; import without --force skips it instead of erroring. */
  duplicate: "topik_duplicate",
} as const;
