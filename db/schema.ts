// Single source of truth for the D1 schema (SPEC §5).
// After changing this file run `npm run db:generate`, then `npm run db:migrate:local`.
// Conventions: ids are UUID text (generated client-side for offline sync),
// timestamps are integer epoch milliseconds, booleans are 0/1 integers.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  CARD_TYPES,
  DECK_KINDS,
  EXAMPLE_LEVELS,
  IMAGE_SOURCES,
  IMAGE_STATUSES,
  LEARN_LANGS,
  TOPIK_SECTIONS,
  UI_LANGS,
  USAGE_SERVICES,
  type CardType,
  type LearnLang,
} from "../shared/enums";
import type { TopikOptions, TopikVocabEntry } from "../shared/topik";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAt = () =>
  timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date());
const bool = (name: string) => integer(name, { mode: "boolean" });

/** Image of a study item (words, phrases, examples; SPEC F3, M1.8). */
const imageColumns = () => ({
  /** R2 key (images/ai/... or images/upload/...); set when the image is ready. */
  image_key: text("image_key"),
  /** English scene description from Gemini; the fixed style is appended when drawing. */
  image_prompt: text("image_prompt"),
  image_source: text("image_source", { enum: IMAGE_SOURCES }),
  image_status: text("image_status", { enum: IMAGE_STATUSES }).notNull().default("none"),
  /** Part of the AI image key: "0" for the first drawing, a random value for each Redraw. */
  image_nonce: text("image_nonce"),
  /** When drawing was claimed; a pending item older than 2 minutes counts as stalled. */
  image_requested_at: timestamp("image_requested_at"),
  /** Model that actually drew the image (null for uploads), for fallback statistics. */
  image_model: text("image_model"),
});

export const profiles = sqliteTable("profiles", {
  id: id(),
  name: text("name").notNull(),
  avatar: text("avatar").notNull(),
  /** R2 key of an uploaded photo (M2.10); takes priority over `avatar` (emoji) when set. */
  avatar_photo: text("avatar_photo"),
  ui_lang: text("ui_lang", { enum: UI_LANGS }).notNull().default("vi"),
  gloss_lang: text("gloss_lang", { enum: UI_LANGS }).notNull().default("vi"),
  is_kid: bool("is_kid").notNull().default(false),
  pin_hash: text("pin_hash"),
  daily_new_limit: integer("daily_new_limit").notNull().default(10),
  study_langs: text("study_langs", { mode: "json" })
    .$type<LearnLang[]>()
    .notNull()
    .default(sql`'[]'`),
  /**
   * Which review card types this profile practises (M6.6). Turning one off only hides its cards
   * from the queue: the rows, their FSRS schedule and their review history stay untouched, so
   * turning it back on resumes the old schedule. Defaults to all three, which is what every
   * profile did before this setting existed.
   */
  card_types: text("card_types", { mode: "json" })
    .$type<CardType[]>()
    .notNull()
    .default(sql`'["recognition","picture","listening"]'`),
  created_at: createdAt(),
});

export const words = sqliteTable(
  "words",
  {
    id: id(),
    lang: text("lang", { enum: LEARN_LANGS }).notNull(),
    term: text("term").notNull(),
    reading: text("reading").notNull(),
    pos: text("pos").notNull(),
    gloss_vi: text("gloss_vi").notNull(),
    gloss_en: text("gloss_en").notNull(),
    gloss_ko: text("gloss_ko").notNull(),
    /** Hanja (traditional characters) of a Sino-Korean word; null for other words. */
    hanja: text("hanja"),
    han_viet: text("han_viet"),
    emoji: text("emoji"),
    ...imageColumns(),
    /** Null until TTS audio has been generated. */
    audio_key: text("audio_key"),
    notes: text("notes"),
    ai_generated: bool("ai_generated").notNull().default(false),
    verified: bool("verified").notNull().default(false),
    created_by_profile: text("created_by_profile").references(() => profiles.id, {
      onDelete: "set null",
    }),
    created_at: createdAt(),
    updated_at: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("words_lang_term_uq").on(t.lang, t.term),
    // M2.7: "I added" library filter (GET /api/words?scope=mine).
    index("words_created_by_idx").on(t.created_by_profile),
  ],
);

/**
 * A phrase (collocation / short expression) built on one root word (SPEC F2, M1.7).
 * Rows that belong to a phrase (examples, cards) keep `word_id` = the root word and set
 * `phrase_id`; SQL triggers in migration 0002 enforce that pairing (not managed by drizzle-kit).
 */
export const phrases = sqliteTable(
  "phrases",
  {
    id: id(),
    word_id: text("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    lang: text("lang", { enum: LEARN_LANGS }).notNull(),
    text: text("text").notNull(),
    reading: text("reading").notNull(),
    gloss_vi: text("gloss_vi").notNull(),
    gloss_en: text("gloss_en").notNull(),
    gloss_ko: text("gloss_ko").notNull(),
    emoji: text("emoji"),
    ...imageColumns(),
    /** Null until TTS audio has been generated. */
    audio_key: text("audio_key"),
    ai_generated: bool("ai_generated").notNull().default(false),
    verified: bool("verified").notNull().default(false),
    created_by_profile: text("created_by_profile").references(() => profiles.id, {
      onDelete: "set null",
    }),
    created_at: createdAt(),
    updated_at: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("phrases_lang_text_uq").on(t.lang, t.text), index("phrases_word_idx").on(t.word_id)],
);

export const examples = sqliteTable(
  "examples",
  {
    id: id(),
    /** The word, or the root word when the example belongs to a phrase. */
    word_id: text("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    /** Set when the example belongs to a phrase (then word_id = the phrase's root word). */
    phrase_id: text("phrase_id").references(() => phrases.id, { onDelete: "cascade" }),
    sentence: text("sentence").notNull(),
    translation_vi: text("translation_vi").notNull(),
    translation_en: text("translation_en").notNull(),
    translation_ko: text("translation_ko").notNull(),
    audio_key: text("audio_key"),
    level: text("level", { enum: EXAMPLE_LEVELS }).notNull(),
    ai_generated: bool("ai_generated").notNull().default(false),
    ...imageColumns(),
  },
  (t) => [index("examples_word_idx").on(t.word_id), index("examples_phrase_idx").on(t.phrase_id)],
);

export const decks = sqliteTable("decks", {
  id: id(),
  name: text("name").notNull(),
  lang: text("lang", { enum: LEARN_LANGS }).notNull(),
  is_kid_deck: bool("is_kid_deck").notNull().default(false),
  /** `default` decks (default-ko, default-en) drive card creation; `album` decks are playlists (M2.4). */
  kind: text("kind", { enum: DECK_KINDS }).notNull().default("default"),
  created_at: createdAt(),
});

export const deck_words = sqliteTable(
  "deck_words",
  {
    deck_id: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    word_id: text("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    /**
     * When the word joined the deck (epoch ms). A trigger in migration 0005 fills it on insert when
     * it is left at 0; rows from before the migration were backfilled with the migration time.
     * Orders "recently added" and picks an album's cover.
     */
    added_at: timestamp("added_at").notNull().default(sql`0`),
  },
  (t) => [primaryKey({ columns: [t.deck_id, t.word_id] }), index("deck_words_word_idx").on(t.word_id)],
);

/** Which decks a profile studies. */
export const profile_decks = sqliteTable(
  "profile_decks",
  {
    profile_id: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    deck_id: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.profile_id, t.deck_id] })],
);

/**
 * One row per (profile, item, card type); the item is the phrase when `phrase_id` is set,
 * otherwise the word. Columns after card_type mirror ts-fsrs `Card`.
 */
export const cards = sqliteTable(
  "cards",
  {
    id: id(),
    profile_id: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** The word, or the root word of a phrase card. */
    word_id: text("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    phrase_id: text("phrase_id").references(() => phrases.id, { onDelete: "cascade" }),
    card_type: text("card_type", { enum: CARD_TYPES }).notNull(),
    // --- ts-fsrs Card ---
    due: timestamp("due").notNull(),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    elapsed_days: integer("elapsed_days").notNull(),
    scheduled_days: integer("scheduled_days").notNull(),
    learning_steps: integer("learning_steps").notNull(),
    reps: integer("reps").notNull(),
    lapses: integer("lapses").notNull(),
    /** ts-fsrs `State` enum value (0 New, 1 Learning, 2 Review, 3 Relearning). */
    state: integer("state").notNull(),
    last_review: timestamp("last_review"),
    // ---
    updated_at: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // One card per type for a word and, separately, for each of its phrases.
    uniqueIndex("cards_word_type_uq")
      .on(t.profile_id, t.word_id, t.card_type)
      .where(sql`phrase_id IS NULL`),
    uniqueIndex("cards_phrase_type_uq")
      .on(t.profile_id, t.phrase_id, t.card_type)
      .where(sql`phrase_id IS NOT NULL`),
    index("cards_profile_due_idx").on(t.profile_id, t.due),
    // M2.7: "I'm learning" library filter (GET /api/words?scope=learning) — EXISTS(cards WHERE
    // profile_id=? AND word_id=?) over every card type/phrase, not just the partial uniques above.
    index("cards_profile_word_idx").on(t.profile_id, t.word_id),
  ],
);

/**
 * Append-only. Columns mirror ts-fsrs `ReviewLog`; its `review` field is stored as `reviewed_at`.
 * Logs outlive their card (card_id → NULL when a word/phrase is deleted); `lang` keeps stats per language.
 */
export const review_logs = sqliteTable(
  "review_logs",
  {
    id: id(),
    card_id: text("card_id").references(() => cards.id, { onDelete: "set null" }),
    profile_id: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** ts-fsrs `Rating` enum value (1 Again, 2 Hard, 3 Good, 4 Easy). */
    rating: integer("rating").notNull(),
    reviewed_at: timestamp("reviewed_at").notNull(),
    duration_ms: integer("duration_ms"),
    lang: text("lang", { enum: LEARN_LANGS }).notNull(),
    // --- ts-fsrs ReviewLog (card state before this review) ---
    state: integer("state").notNull(),
    due: timestamp("due").notNull(),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    elapsed_days: integer("elapsed_days").notNull(),
    last_elapsed_days: integer("last_elapsed_days").notNull(),
    scheduled_days: integer("scheduled_days").notNull(),
    learning_steps: integer("learning_steps").notNull(),
  },
  (t) => [
    index("review_logs_card_idx").on(t.card_id),
    index("review_logs_profile_time_idx").on(t.profile_id, t.reviewed_at),
  ],
);

export const pron_attempts = sqliteTable(
  "pron_attempts",
  {
    id: id(),
    profile_id: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // Deleting the content a practice attempt was about must not delete the practice history:
    // the links become NULL and the history stays readable through `reference_text` (M2.6).
    word_id: text("word_id").references(() => words.id, { onDelete: "set null" }),
    phrase_id: text("phrase_id").references(() => phrases.id, { onDelete: "set null" }),
    example_id: text("example_id").references(() => examples.id, { onDelete: "set null" }),
    lang: text("lang", { enum: LEARN_LANGS }).notNull(),
    reference_text: text("reference_text").notNull(),
    pron_score: real("pron_score").notNull(),
    accuracy: real("accuracy").notNull(),
    fluency: real("fluency").notNull(),
    completeness: real("completeness").notNull(),
    details_json: text("details_json", { mode: "json" }).$type<unknown>(),
    created_at: createdAt(),
  },
  (t) => [
    index("pron_attempts_profile_time_idx").on(t.profile_id, t.created_at),
    index("pron_attempts_word_idx").on(t.word_id),
  ],
);

/** One Hanja character (F7): Hán-Việt reading and Vietnamese meaning. */
export const han_chars = sqliteTable("han_chars", {
  hanja: text("hanja").primaryKey(),
  han_viet: text("han_viet").notNull(),
  meaning_vi: text("meaning_vi").notNull(),
  ai_generated: bool("ai_generated").notNull().default(false),
  verified: bool("verified").notNull().default(false),
});

export const word_chars = sqliteTable(
  "word_chars",
  {
    word_id: text("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    hanja: text("hanja")
      .notNull()
      .references(() => han_chars.hanja),
  },
  (t) => [
    primaryKey({ columns: [t.word_id, t.position] }),
    index("word_chars_hanja_idx").on(t.hanja),
  ],
);

/** Cache for LLM responses. key = hash(task + input + model). */
export const ai_cache = sqliteTable("ai_cache", {
  key: text("key").primaryKey(),
  response_json: text("response_json", { mode: "json" }).$type<unknown>().notNull(),
  /** Model that actually answered (LLM_MODEL, or LLM_FALLBACK_MODEL when the primary was busy). */
  model: text("model"),
  created_at: createdAt(),
});

/** Daily quota counters per profile and paid service. date = 'YYYY-MM-DD'. */
export const usage_daily = sqliteTable(
  "usage_daily",
  {
    date: text("date").notNull(),
    profile_id: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    service: text("service", { enum: USAGE_SERVICES }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.date, t.profile_id, t.service] })],
);

// --- TOPIK II practice (SPEC F12, M6.1) --------------------------------------------------------

/**
 * One multiple-choice question. No "question type" field and no separate reading-group entity:
 * a pair of questions sharing one reading passage simply repeats it in each question's own
 * `instruction`/`stem`. Images (`image_key` inside `stem`/`options`) are R2 keys, stored content-
 * addressed like other uploads (`storeUploadedImage()`), with their own, looser size limit.
 */
export const topik_questions = sqliteTable(
  "topik_questions",
  {
    id: id(),
    section: text("section", { enum: TOPIK_SECTIONS }).notNull(),
    /** Free-form source/exercise label, e.g. "Yonsei/연습1" — unique together with `number`. */
    exam: text("exam").notNull(),
    /** The real TOPIK question number (not a position within `exam`). */
    number: integer("number").notNull(),
    /** Explicit question-number block, e.g. "1~2" or "9" (from the source heading/file name). */
    block: text("block").notNull(),
    instruction: text("instruction"),
    stem_text: text("stem_text"),
    stem_image_key: text("stem_image_key"),
    /** 4 options: [{ text, image_key }, ...] (TopikContent[4], shared/topik.ts). */
    options: text("options", { mode: "json" }).$type<TopikOptions>().notNull(),
    correct_option: integer("correct_option").notNull(),
    /** Set by the import script when it had to guess/cross-check something (e.g. a number
     * mismatch); shown on the review screen so those rows surface first. Null otherwise. */
    warning: text("warning"),
    /** Tappable words found in the question's text (M6.2), generated once by AI; null until
     * generated, [] once generated with nothing to show (e.g. an image-only question). */
    vocab: text("vocab", { mode: "json" }).$type<TopikVocabEntry[]>(),
    /** Set together with `vocab`; a null here (not an empty `vocab`) means "not generated yet". */
    vocab_checked_at: timestamp("vocab_checked_at"),
    /** Why the correct option is right and the others wrong (M6.3), generated once by AI; null
     * until generated (or if content-check rejected it twice). Never sent before the question is
     * answered (worker/routes/topik.ts only puts it on the attempt response). */
    explanation_vi: text("explanation_vi"),
    /** 3-5 lemmas from this question's own `vocab` (M6.3) — never a term the AI invented. */
    key_terms: text("key_terms", { mode: "json" }).$type<string[]>(),
    /** Set together with `explanation_vi`/`key_terms`; null means "not generated yet". */
    explain_checked_at: timestamp("explain_checked_at"),
    /** false until an adult reviews a freshly imported question and saves it. */
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    created_by_profile: text("created_by_profile").references(() => profiles.id, { onDelete: "set null" }),
    created_at: createdAt(),
    updated_at: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("topik_questions_section_exam_number_uq").on(t.section, t.exam, t.number),
    index("topik_questions_section_number_idx").on(t.section, t.number),
  ],
);

/** One ts-fsrs card per (profile, question); same fields as `cards`, scheduled independently. */
export const topik_cards = sqliteTable(
  "topik_cards",
  {
    id: id(),
    profile_id: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    question_id: text("question_id")
      .notNull()
      .references(() => topik_questions.id, { onDelete: "cascade" }),
    due: timestamp("due").notNull(),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    elapsed_days: integer("elapsed_days").notNull(),
    scheduled_days: integer("scheduled_days").notNull(),
    learning_steps: integer("learning_steps").notNull(),
    reps: integer("reps").notNull(),
    lapses: integer("lapses").notNull(),
    state: integer("state").notNull(),
    last_review: timestamp("last_review"),
    updated_at: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("topik_cards_profile_question_uq").on(t.profile_id, t.question_id),
    index("topik_cards_profile_due_idx").on(t.profile_id, t.due),
  ],
);

/**
 * Practice history. `question_id` is `SET NULL` if the question is later deleted, but `section`/
 * `exam`/`number` are copied so the attempt stays readable (same idea as `pron_attempts`).
 */
export const topik_attempts = sqliteTable(
  "topik_attempts",
  {
    id: id(),
    profile_id: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    question_id: text("question_id").references(() => topik_questions.id, { onDelete: "set null" }),
    section: text("section", { enum: TOPIK_SECTIONS }).notNull(),
    exam: text("exam").notNull(),
    number: integer("number").notNull(),
    selected_option: integer("selected_option").notNull(),
    is_correct: integer("is_correct", { mode: "boolean" }).notNull(),
    duration_ms: integer("duration_ms"),
    answered_at: createdAt(),
  },
  (t) => [
    index("topik_attempts_profile_time_idx").on(t.profile_id, t.answered_at),
    index("topik_attempts_question_idx").on(t.question_id),
  ],
);
