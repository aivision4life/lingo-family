// TOPIK II practice (SPEC F12, M6.1; per-question vocabulary M6.2): question bank, import,
// practice sessions and the "tap a word" vocabulary AI adds to each question.
import { z } from "zod";
import { topikSectionSchema, topikTestKindSchema, topikTestStatusSchema } from "./enums";
import { DEFAULT_SESSION_SIZE } from "./profile";
import { posSchema } from "./word";
export { TOPIK_ALBUM, topikWordSourceSchema, TOPIK_SOURCES_MAX, type TopikWordSource } from "./topikSource";

export const TOPIK_OPTION_COUNT = 4;

/** Looser than the general upload limits (SPEC F3): exam scans need to stay legible. */
export const TOPIK_IMAGE_MAX_SIDE = 1600;
export const TOPIK_IMAGE_MAX_BYTES = 1_000_000;

/** A stem or one option: text and/or an image (R2 key, content-addressed like other uploads). */
const topikContentFields = { text: z.string().trim().nullable(), image_key: z.string().nullable() };

/** A stem or one option as it may be *saved*: it has to carry something. */
export const topikContentSchema = z
  .object(topikContentFields)
  .refine((c) => c.text !== null || c.image_key !== null, { message: "topik_content_empty", path: ["text"] });

/**
 * The same shape as it may be *sent to practice*, where empty is legitimate: a listening
 * question's stem is its transcript and the server withholds it until the learner has answered
 * (M7.1), so requiring content here would reject exactly the payload the rule is protecting.
 */
export const topikSentContentSchema = z.object(topikContentFields);
export type TopikContent = z.infer<typeof topikContentSchema>;

export const topikOptionsSchema = z.tuple([topikContentSchema, topikContentSchema, topikContentSchema, topikContentSchema]);
export type TopikOptions = z.infer<typeof topikOptionsSchema>;

/**
 * A stem's `text` can carry a lightweight underline marker, `<u>…</u>` (M6.5-ish): some question
 * types (문항 3-4, "choose the closest meaning to the underlined part") underline a phrase in the
 * stem itself — a completely different use of underline than an option's own (which option is
 * correct, a separate boolean, never embedded as markup). Only these two exact literal tags are
 * ever treated as markup; any other `<...>` the real exam text happens to contain (e.g. "<보기>")
 * is left untouched, shown as plain text. Pure and shared so both the parser (writes it) and the
 * client (reads it, e.g. `vocabSegments.ts#segmentTextWithUnderline`) agree on the one format.
 */
export type UnderlineRun = { text: string; underlined: boolean };
const UNDERLINE_TAG = /<u>([\s\S]*?)<\/u>/g;

export function splitUnderline(text: string): UnderlineRun[] {
  const out: UnderlineRun[] = [];
  let last = 0;
  UNDERLINE_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UNDERLINE_TAG.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), underlined: false });
    if (m[1]) out.push({ text: m[1], underlined: true });
    last = UNDERLINE_TAG.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), underlined: false });
  return out;
}

/** The stem's plain reading, with any `<u>`/`</u>` markers removed — used anywhere the underline
 * markup must not leak: the LLM prompts (vocab extraction, explanation) and the review list's
 * truncated one-line preview. */
export function stripUnderline(text: string): string {
  return splitUnderline(text)
    .map((r) => r.text)
    .join("");
}

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

/**
 * A grammar ending/particle entry (pos "other" or "particle") is not real picture-library
 * vocabulary (drawing an image for "-자마자" is meaningless and wastes an image-quota unit), so it
 * never looks itself up in the library and never offers to be added — used both by the client
 * (M6.2's tap-a-word popup, M6.3's key-terms list) and the server (M6.3's per-profile key-term
 * resolution skips a library/card lookup for these).
 */
export function isGrammarPos(pos: TopikVocabEntry["pos"]): boolean {
  return pos === "other" || pos === "particle";
}

/** Lemmas of `vocab` entries picked as key to answering a question right (M6.3); 3-5 once generated. */
export const topikKeyTermsSchema = z.array(z.string());

/**
 * One key-term shown after an attempt (M6.3): `vocab`'s own gloss, plus whether/where it already
 * exists in the library, so the client needs no extra lookup. `existing_word_id` is set only for a
 * word already in the learner's library (never for a grammar entry, which has no library form).
 */
export const topikKeyTermViewSchema = z.object({
  lemma: z.string(),
  pos: posSchema,
  gloss_vi: z.string(),
  existing_word_id: z.string().nullable(),
});
export type TopikKeyTermView = z.infer<typeof topikKeyTermViewSchema>;

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
  /** What this question is worth in a mock test (M6.4): read from the instruction's "각 N점" on
   * import, and correctable by hand on the review screen for a paper that does not say. */
  points: z.number().int().positive().max(10),
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
/** The clip a listening question is asked about, as practice needs it (M7.1). */
export const topikClipSchema = z.object({
  audio_key: z.string(),
  start_ms: z.number().int().nonnegative(),
  speech_end_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
});
export type TopikClip = z.infer<typeof topikClipSchema>;

export const topikQuestionSchema = topikQuestionInputSchema.extend({
  id: z.string(),
  /** false for a freshly imported question until an adult reviews and saves it (M6.1). */
  verified: z.boolean(),
  /** Set by the import script when something had to be cross-checked/guessed; null otherwise. */
  warning: z.string().nullable(),
  /** Tappable words found in the question's text (M6.2); [] once generated with nothing to show
   * (e.g. an image-only question), until then also []. */
  vocab: topikVocabListSchema,
  /** Explanation + key terms (M6.3); null/[] until generated, or if there was nothing to explain. */
  explanation_vi: z.string().nullable(),
  key_terms: topikKeyTermsSchema,
  /** Whether `vocab`/`explanation_vi` have ever been generated (M6.4-ish: generation moved to practice
   * time, so most freshly-imported/approved questions sit at `false` until actually studied) — the
   * review screen's per-question status; distinguishes "not generated yet" from "generated empty". */
  vocab_ready: z.boolean(),
  explain_ready: z.boolean(),
  /**
   * Listening only (M7.1): the clip this question is asked about, so the review screen can play it
   * and show at a glance whether one is attached yet. Unlike practice, the review screen is
   * adult-only and already shows the transcript, so nothing is withheld here.
   */
  audio: topikClipSchema.nullable(),
  created_by_profile: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type TopikQuestion = z.infer<typeof topikQuestionSchema>;
export const topikQuestionListSchema = z.array(topikQuestionSchema);

/** Review screen (`/topik/manage`): filter by exam/block/verified, search by content or an exact
 * question number, paged (`limit`/`offset`). */
export const topikQuestionListQuerySchema = z.object({
  profile_id: z.string().min(1),
  /** Reading and listening are reviewed separately (M7.1): one bank is ~230 rows, the other grows
   * alongside it, and their exam labels and blocks have nothing to do with each other. */
  section: topikSectionSchema.optional(),
  verified: z.enum(["0", "1"]).optional(),
  exam: z.string().trim().min(1).optional(),
  block: z.string().trim().min(1).optional(),
  /** Free text (matched against the stem/options) — or, when it is all digits, an exact question number. */
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type TopikQuestionListQuery = z.infer<typeof topikQuestionListQuerySchema>;

export const topikQuestionPageSchema = z.object({ questions: topikQuestionListSchema, total: z.number().int().nonnegative() });
export type TopikQuestionPage = z.infer<typeof topikQuestionPageSchema>;

/** Values for the exam/block filter dropdowns, already scoped to the same `verified` filter the
 * review screen is currently showing (so a dropdown never offers a label with 0 matching rows). */
export const topikFacetsSchema = z.object({ exams: z.array(z.string()), blocks: z.array(z.string()) });
export type TopikFacets = z.infer<typeof topikFacetsSchema>;


/**
 * Question as sent for practice: never carries the answer.
 *
 * For a **listening** question the server also strips `stem.text` and `vocab` (M7.1). The stem of a
 * listening question is its transcript, typed in the same Word table as the question, and the
 * vocabulary is generated from that transcript — sending either before the learner answers would
 * turn a listening exercise into a reading one. Both arrive with the attempt result instead.
 * Reading questions are unaffected.
 *
 * `vocab_ready` false means generation was just kicked off (GET /topik/session, M6.4-ish) and the
 * client should poll `GET /topik/questions/:id/content` for it instead of treating `vocab: []` as
 * "nothing to tap".
 */
export const topikPracticeQuestionSchema = z.object({
  ...commonFields,
  stem: topikSentContentSchema,
  id: z.string(),
  vocab: topikVocabListSchema,
  vocab_ready: z.boolean(),
  /** Listening only; null for reading and for a listening question with no clip yet. */
  audio: topikClipSchema.nullable(),
  /**
   * Which group of questions this one belongs to (M7.5): the clip they share, or its own id when
   * it has none. From question 21 a recording is followed by two questions, and the real paper
   * prints them on one page — the tape plays once, so they are answered together or not at all.
   */
  group_id: z.string(),
});
export type TopikPracticeQuestion = z.infer<typeof topikPracticeQuestionSchema>;

/** `GET /topik/questions/:id/content` — polled by the practice screen while vocab and/or the
 * explanation are still being generated in the background (M6.4-ish), and by the review screen after
 * the per-question "Tạo dữ liệu AI" button. Same trust level as the rest of this family app's API:
 * not gated on "has this profile already attempted the question", since the practice UI is the only
 * intended caller and the family's Cloudflare Access login is the real access boundary. */
export const topikQuestionContentSchema = z.object({
  vocab: topikVocabListSchema,
  vocab_ready: z.boolean(),
  explanation_vi: z.string().nullable(),
  key_terms: z.array(topikKeyTermViewSchema),
  explain_ready: z.boolean(),
});
export type TopikQuestionContent = z.infer<typeof topikQuestionContentSchema>;

/** `POST /topik/questions/:id/generate-content` — the review screen's per-question "Tạo dữ liệu AI"
 * button; starts background generation (same as a practice session would) for whichever of
 * vocab/explanation this one question is still missing. */
export const topikGenerateContentResponseSchema = z.object({ started: z.boolean() });

// --- Listening audio (M7.1) -----------------------------------------------------------------

/**
 * One clip of a listening paper's single mp3. The three timestamps are deliberate: practice plays
 * `start_ms` → `speech_end_ms` (the talking, without the 15-second answer gap that follows), while
 * a timed mock test plays `start_ms` → `end_ms`, the paper's own pacing.
 */
export const topikSegmentSchema = z.object({
  id: z.string(),
  idx: z.number().int().positive(),
  start_ms: z.number().int().nonnegative(),
  speech_end_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  /** Question numbers asked about this clip; several when a dialogue carries a pair. */
  questions: z.array(z.number().int().positive()),
});
export type TopikSegment = z.infer<typeof topikSegmentSchema>;

/** One exam's audio with its clips, for the review screen. */
export const topikAudioSchema = z.object({
  id: z.string(),
  section: topikSectionSchema,
  exam: z.string(),
  /** R2 key; play it through `/api/media/<key>` with a byte range. */
  audio_key: z.string(),
  duration_ms: z.number().int().nonnegative(),
  /** Until this is true, none of the exam's questions reach practice. */
  verified: z.boolean(),
  /** How many of the exam's questions have no clip yet. */
  unassigned_questions: z.number().int().nonnegative(),
  segments: z.array(topikSegmentSchema),
});
export type TopikAudio = z.infer<typeof topikAudioSchema>;

/** Row in the audio list (no segments). */
export const topikAudioSummarySchema = topikAudioSchema.omit({ segments: true }).extend({
  segment_count: z.number().int().nonnegative(),
  question_count: z.number().int().nonnegative(),
});
export type TopikAudioSummary = z.infer<typeof topikAudioSummarySchema>;
export const topikAudioListSchema = z.array(topikAudioSummarySchema);

const msField = z.number().int().nonnegative();

/** PATCH /api/topik/segments/:id — any subset of the three timestamps. */
export const topikSegmentUpdateSchema = z
  .object({ start_ms: msField, speech_end_ms: msField, end_ms: msField })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "nothing_to_update");
export type TopikSegmentUpdate = z.infer<typeof topikSegmentUpdateSchema>;

/** PATCH /api/topik/questions/:id/segment — `segment_id: null` unlinks the question. */
export const topikQuestionSegmentSchema = z.object({ segment_id: z.string().nullable() });

/** PATCH /api/topik/audio/:id — approving (or un-approving) a whole exam's clips. */
export const topikAudioVerifySchema = z.object({ verified: z.boolean() });

/** One contiguous run of question numbers sharing the same instruction (for the block picker). */
export const topikBlockSchema = z.object({
  section: topikSectionSchema,
  block: z.string(),
  from: z.number().int(),
  to: z.number().int(),
  /** How many verified questions exist in this range (may cover more than one `block` label). */
  count: z.number().int().nonnegative(),
  /**
   * Of those, how many are new to the profile (M6.9): no `topik_cards` row, which is exactly what
   * a session treats as a never-attempted question. Counted from cards rather than from attempts
   * (M7.2) so this number can never disagree with what a real review hands out — a "practise
   * anyway" answer writes an attempt but no card, and must not quietly turn a new question into a
   * seen one. A question skipped during a session writes neither, so it stays counted here.
   */
  unseen: z.number().int().nonnegative(),
  /** Of those, how many the profile already knows: the question's card reached ts-fsrs `Review`
   * (M6.11) — the same "already knows it" rule the vocabulary key-terms use. */
  mastered: z.number().int().nonnegative(),
  /** Answered before and due again now, so a session would include them (M7.2). */
  due: z.number().int().nonnegative(),
  /** Answered before and *not* due yet: a session deliberately leaves these out, which is why a
   * block can show work remaining and still open an empty session. Spelling the number out is the
   * whole point — "thuộc 1/6 · chưa làm 0" with an empty session reads as a bug otherwise. */
  later: z.number().int().nonnegative(),
  /** When the first of those `later` questions comes due (epoch ms); null when none are waiting. */
  next_due_at: z.number().int().nullable(),
});
export type TopikBlock = z.infer<typeof topikBlockSchema>;
export const topikBlockListSchema = z.array(topikBlockSchema);

/**
 * What one question is worth, read from its own instruction: a TOPIK paper writes "(각 2점)" —
 * "2 points each" — in the instruction that covers a block of questions (M6.4).
 *
 * Returns null when the instruction does not say, and the caller keeps the default of 2: TOPIK II
 * listening is 50 questions at 2 points for 100, so 2 is the right guess, while 0 would make a
 * question silently worth nothing in a result. An adult can always correct it on the review
 * screen, which is the only way a paper that slips in a 3-point question without saying so can be
 * scored right.
 */
export function pointsFromInstruction(instruction: string | null): number | null {
  if (!instruction) return null;
  const m = /각\s*(\d+)\s*점/.exec(instruction);
  if (!m) return null;
  const points = Number(m[1]);
  return Number.isInteger(points) && points > 0 && points <= 10 ? points : null;
}

/** The default when nothing says otherwise — see `pointsFromInstruction`. */
export const DEFAULT_QUESTION_POINTS = 2;

/**
 * How many questions a practice session asks when the profile has no say.
 *
 * The real number is the profile's own `session_size` (M6.13, `shared/profile.ts`); this is only
 * the fallback for a profile that cannot be read.
 */
export const TOPIK_SESSION_SIZE = DEFAULT_SESSION_SIZE;

/**
 * `due` (the default) serves what FSRS says is ready: questions never answered, plus cards that
 * have come due. `all` ignores the schedule and serves the block's questions anyway — practising
 * ahead of time on purpose, which `POST /topik/attempts` then records with `schedule: false`.
 */
export const topikSessionModeSchema = z.enum(["due", "all"]);
export type TopikSessionMode = z.infer<typeof topikSessionModeSchema>;

export const topikSessionRequestSchema = z
  .object({
    profile_id: z.string().min(1),
    section: topikSectionSchema,
    // Query-string values, so coerce (always strings on the wire).
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive(),
    mode: topikSessionModeSchema.default("due"),
  })
  .refine((r) => r.to >= r.from, { message: "topik_range_invalid", path: ["to"] });
export type TopikSessionRequest = z.infer<typeof topikSessionRequestSchema>;
export const topikSessionResponseSchema = z.object({ questions: z.array(topikPracticeQuestionSchema) });

/**
 * Everything that is withheld while a question is being answered (M7.5): the transcript, its
 * tappable words, the explanation and the correct option. Sent for a whole **group** at once —
 * two questions asked about one recording are revealed together or not at all, because the
 * transcript answers both.
 */
export const topikRevealEntrySchema = z.object({
  question_id: z.string(),
  number: z.number().int(),
  correct_option: topikCorrectOptionSchema,
  /** A listening question's transcript; null for reading, where the stem was never hidden. */
  transcript: z.string().nullable(),
  vocab: topikVocabListSchema,
  explanation_vi: z.string().nullable(),
  key_terms: z.array(topikKeyTermViewSchema),
  explain_ready: z.boolean(),
});
export type TopikRevealEntry = z.infer<typeof topikRevealEntrySchema>;

/** `GET /topik/questions/:id/reveal` — giving up on a group and reading it instead. */
export const topikGroupRevealSchema = z.object({ group: z.array(topikRevealEntrySchema) });
export type TopikGroupReveal = z.infer<typeof topikGroupRevealSchema>;

export const topikAttemptRequestSchema = z.object({
  profile_id: z.string().min(1),
  question_id: z.string().min(1),
  selected_option: topikCorrectOptionSchema,
  /** Time from first seeing the question to choosing an answer. */
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  /**
   * Whether this answer may move the FSRS schedule (M7.2). A "practise anyway" session sends
   * false: the attempt is recorded (it happened, and the history should say so, flagged
   * `scheduled = 0`) but no card is created or updated, so a question practised ahead of time is
   * still new — or still due when it was due — for the next real review.
   */
  schedule: z.boolean().optional(),
  /**
   * True while another question about the same recording is still unanswered (M7.5). The server
   * then answers with the verdict for *this* question only and withholds the transcript, the
   * explanation and the words — all three answer the sibling question too, so sending them would
   * hand over a mark that has not been earned. Withheld on the server rather than hidden by the
   * screen: hiding it client-side still puts it on the device.
   */
  group_pending: z.boolean().optional(),
});
export type TopikAttemptRequest = z.infer<typeof topikAttemptRequestSchema>;

export const topikAttemptResultSchema = z.object({
  is_correct: z.boolean(),
  correct_option: topikCorrectOptionSchema,
  /** M6.3: never sent in the session/practice question, only here (the answer is already known
   * by the time this response exists). null if not generated yet. */
  explanation_vi: z.string().nullable(),
  /** Already filtered/prioritized for this profile (not-in-library first, then weak, capped at 5;
   * a term the profile already knows well is left out entirely). */
  key_terms: z.array(topikKeyTermViewSchema),
  /** false while the explanation is still being generated in the background (M6.4-ish, triggered at
   * session start) — the client shows "Đang tạo giải thích..." and polls `.../content` for it. */
  explain_ready: z.boolean(),
  /** M7.1: a listening question's transcript, withheld until now for the same reason as the answer
   * itself. null for reading (whose stem was readable all along) and when none was typed. */
  transcript: z.string().nullable(),
  /** The transcript's tappable words, withheld from the session response for the same reason. */
  vocab: topikVocabListSchema,
  /**
   * The whole group's reveal, sent only by the answer that completes it (M7.5), so the screen can
   * show the transcript once with both questions' explanations under it. Empty while a sibling is
   * still unanswered, and for a question that has no sibling it holds just itself.
   */
  group_reveal: z.array(topikRevealEntrySchema),
});
export type TopikAttemptResult = z.infer<typeof topikAttemptResultSchema>;

/** `GET /topik/questions/:id/stats` — one profile's own full history on one question (every
 * session, not just the current one): shown small at the bottom of the practice screen so the
 * learner can see "I've gotten this one right 7/10 times" without it being a spoiler (it says
 * nothing about which option is correct). */
export const topikQuestionStatsSchema = z.object({ attempts: z.number().int().nonnegative(), correct: z.number().int().nonnegative() });
export type TopikQuestionStats = z.infer<typeof topikQuestionStatsSchema>;

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
  /** A paper with a hole in its numbering cannot be sat: see `isContiguousFromOne`. */
  notContiguous: "topik_test_not_contiguous",
  /** Asked for more questions than the paper has ready. */
  tooShort: "topik_test_too_short",
  /** A mixed test the bank cannot fill: no clip starts at some position (reported with it). */
  bankShort: "topik_test_bank_short",
  /** Answering or finishing a test that is already finished or abandoned. */
  notRunning: "topik_test_not_running",
  /** Reading a cancelled sitting: it has no result, and must not leak the answers. */
  abandoned: "topik_test_abandoned",
} as const;

// --- Mock test (M6.4) -------------------------------------------------------------------------

/** How many questions one sitting covers. "full" = every question the paper has ready. */
export const TOPIK_TEST_LENGTHS = [20, 30] as const;
export const topikTestLengthSchema = z.union([z.literal(20), z.literal(30), z.literal("full")]);
export type TopikTestLength = z.infer<typeof topikTestLengthSchema>;

/** One length offered for a paper, with the reason when it cannot be taken. */
export const topikTestLengthOptionSchema = z.object({
  length: topikTestLengthSchema,
  available: z.boolean(),
  /** How many questions this length would actually cover (so "full" can say "12 câu"). */
  questions: z.number().int().nonnegative(),
});

/** A finished sitting, as the picker lists it: "đã thi 2 lần: 32/50, 38/50". */
export const topikTestHistoryEntrySchema = z.object({
  id: z.string(),
  score_points: z.number().int(),
  total_points: z.number().int(),
  question_count: z.number().int(),
  correct_count: z.number().int(),
  finished_at: z.number().int(),
});

export const topikTestOptionSchema = z.object({
  exam: z.string(),
  /** Verified questions that have a clip whose audio is approved — what a test can actually use. */
  ready_questions: z.number().int().nonnegative(),
  /** True only when those questions run 1, 2, 3, … with no hole: a paper missing question 7
   * cannot be sat as "questions 1-20" without quietly being a different test. */
  contiguous: z.boolean(),
  lengths: z.array(topikTestLengthOptionSchema),
  history: z.array(topikTestHistoryEntrySchema),
});
export const topikTestOptionListSchema = z.array(topikTestOptionSchema);
export type TopikTestOption = z.infer<typeof topikTestOptionSchema>;

/**
 * The mixed paper (M6.5), which is not a paper at all: every position is drawn from the whole bank,
 * so it has no exam of its own. A length says which position it ran out at rather than just
 * "not ready" — "the bank has nothing for question 23" is something the owner can act on.
 */
export const topikMixedOptionSchema = z.object({
  /** Questions in the bank that a mixed test could use at all. */
  ready_questions: z.number().int().nonnegative(),
  /** The longest test the bank can currently fill, counting from question 1 with no hole. */
  reachable: z.number().int().nonnegative(),
  lengths: z.array(topikTestLengthOptionSchema.extend({ missing_position: z.number().int().positive().nullable() })),
  history: z.array(topikTestHistoryEntrySchema),
});
export type TopikMixedOption = z.infer<typeof topikMixedOptionSchema>;

/** What the picker screen loads: the original papers, and the one mixed card above them. */
export const topikTestOptionsSchema = z.object({
  papers: topikTestOptionListSchema,
  /** Null for a section with no clips to draw from — the mixed draw takes clips, not questions. */
  mixed: topikMixedOptionSchema.nullable(),
});
export type TopikTestOptions = z.infer<typeof topikTestOptionsSchema>;

export type TopikTestCreate = z.infer<typeof topikTestCreateSchema>;
export const topikTestCreateSchema = z
  .object({
    profile_id: z.string().min(1),
    section: topikSectionSchema,
    kind: topikTestKindSchema.default("original"),
    /** The paper to sit. A mixed test has none: its questions come from everywhere. */
    exam: z.string().min(1).optional(),
    length: topikTestLengthSchema,
  })
  .refine((v) => v.kind === "mixed" || !!v.exam, { message: "exam_required", path: ["exam"] });

/**
 * One position of a running test. No `correct_option`, and for listening no transcript either —
 * same rule as the practice session: the answer must not be in the payload during the exam.
 */
export const topikTestQuestionSchema = z.object({
  position: z.number().int().positive(),
  question_id: z.string(),
  number: z.number().int().positive(),
  points: z.number().int().positive(),
  instruction: z.string().nullable(),
  /** Which paper this question came from. Shown only in a mixed sitting, where it changes. */
  exam: z.string(),
  /** The clip this question shares with the rest of its group (M7.5), or its own id when alone. */
  group_id: z.string(),
  stem: topikSentContentSchema,
  options: topikOptionsSchema,
  selected_option: topikCorrectOptionSchema.nullable(),
  /** Where this position's clip sits in the exam's mp3, so the screen can follow the tape. */
  clip: topikClipSchema.nullable(),
});

export type TopikTestQuestion = z.infer<typeof topikTestQuestionSchema>;

/**
 * Everything a sitting needs to run.
 *
 * For an original paper the audio is **one span** of one file: the approval rules guarantee an
 * exam's clips are contiguous (no gaps, no overlaps), so the tape plays from the first clip's start
 * to the last clip's end, silences and all, exactly as the real exam paces it.
 *
 * A mixed paper has `audio: null` and carries everything in the per-question `clip`s instead —
 * there is no one file to span, so the client stitches those clips into one tape (M6.5).
 */
export const topikTestRunSchema = z.object({
  id: z.string(),
  section: topikSectionSchema,
  kind: topikTestKindSchema,
  source_exam: z.string().nullable(),
  status: topikTestStatusSchema,
  question_count: z.number().int(),
  total_points: z.number().int(),
  started_at: z.number().int(),
  audio: z
    .object({ audio_key: z.string(), start_ms: z.number().int(), end_ms: z.number().int() })
    .nullable(),
  questions: z.array(topikTestQuestionSchema),
});
export type TopikTestRun = z.infer<typeof topikTestRunSchema>;

export const topikTestAnswerSchema = z.object({
  profile_id: z.string().min(1),
  selected_option: topikCorrectOptionSchema,
});

export type TopikTestFinish = z.infer<typeof topikTestFinishSchema>;
export const topikTestFinishSchema = z.object({
  profile_id: z.string().min(1),
  duration_ms: z.number().int().nonnegative(),
  pause_count: z.number().int().nonnegative(),
  paused_ms: z.number().int().nonnegative(),
  /** Answers that never reached the server while the tape was running (a phone on a bad
   * connection queues them); applied before grading so a lost request cannot cost a mark. */
  answers: z.array(z.object({ position: z.number().int().positive(), selected_option: topikCorrectOptionSchema })).optional(),
});

/** One position in a finished result: the answer is out in the open now. */
export const topikTestResultItemSchema = z.object({
  position: z.number().int().positive(),
  question_id: z.string().nullable(),
  number: z.number().int(),
  points: z.number().int(),
  /** Read live from the question, not snapshotted: a deleted question simply loses its label. */
  exam: z.string().nullable(),
  selected_option: topikCorrectOptionSchema.nullable(),
  correct_option: topikCorrectOptionSchema,
  is_correct: z.boolean(),
  /** For the per-question review inside the result: listen again, read, see the explanation. */
  clip: topikClipSchema.nullable(),
  transcript: z.string().nullable(),
  /** The question as it was asked. A listening paper could do without it — its transcript and its
   * clip are the content — but a reading paper reviewed without the passage, the gap and the four
   * options says only "you chose 2, the answer was 3", which teaches nothing. */
  instruction: z.string().nullable(),
  stem: topikContentSchema.nullable(),
  options: z.array(topikContentSchema).nullable(),
});

export const topikTestResultSchema = z.object({
  id: z.string(),
  section: topikSectionSchema,
  kind: topikTestKindSchema,
  source_exam: z.string().nullable(),
  status: topikTestStatusSchema,
  question_count: z.number().int(),
  correct_count: z.number().int(),
  score_points: z.number().int(),
  total_points: z.number().int(),
  duration_ms: z.number().int().nullable(),
  pause_count: z.number().int(),
  paused_ms: z.number().int(),
  finished_at: z.number().int().nullable(),
  items: z.array(topikTestResultItemSchema),
});
export type TopikTestResult = z.infer<typeof topikTestResultSchema>;
