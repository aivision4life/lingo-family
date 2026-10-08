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
  EXAMPLE_LEVELS,
  LEARN_LANGS,
  UI_LANGS,
  USAGE_SERVICES,
  type LearnLang,
} from "../shared/enums";

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

export const profiles = sqliteTable("profiles", {
  id: id(),
  name: text("name").notNull(),
  avatar: text("avatar").notNull(),
  ui_lang: text("ui_lang", { enum: UI_LANGS }).notNull().default("vi"),
  gloss_lang: text("gloss_lang", { enum: UI_LANGS }).notNull().default("vi"),
  is_kid: bool("is_kid").notNull().default(false),
  pin_hash: text("pin_hash"),
  daily_new_limit: integer("daily_new_limit").notNull().default(10),
  study_langs: text("study_langs", { mode: "json" })
    .$type<LearnLang[]>()
    .notNull()
    .default(sql`'[]'`),
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
    image_key: text("image_key"),
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
  (t) => [uniqueIndex("words_lang_term_uq").on(t.lang, t.term)],
);

export const examples = sqliteTable(
  "examples",
  {
    id: id(),
    word_id: text("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    sentence: text("sentence").notNull(),
    translation_vi: text("translation_vi").notNull(),
    translation_en: text("translation_en").notNull(),
    translation_ko: text("translation_ko").notNull(),
    audio_key: text("audio_key"),
    level: text("level", { enum: EXAMPLE_LEVELS }).notNull(),
    ai_generated: bool("ai_generated").notNull().default(false),
  },
  (t) => [index("examples_word_idx").on(t.word_id)],
);

export const decks = sqliteTable("decks", {
  id: id(),
  name: text("name").notNull(),
  lang: text("lang", { enum: LEARN_LANGS }).notNull(),
  is_kid_deck: bool("is_kid_deck").notNull().default(false),
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

/** One row per (profile, word, card type). Columns after card_type mirror ts-fsrs `Card`. */
export const cards = sqliteTable(
  "cards",
  {
    id: id(),
    profile_id: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    word_id: text("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
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
    uniqueIndex("cards_profile_word_type_uq").on(t.profile_id, t.word_id, t.card_type),
    index("cards_profile_due_idx").on(t.profile_id, t.due),
  ],
);

/** Append-only. Columns mirror ts-fsrs `ReviewLog`; its `review` field is stored as `reviewed_at`. */
export const review_logs = sqliteTable(
  "review_logs",
  {
    id: id(),
    card_id: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    profile_id: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** ts-fsrs `Rating` enum value (1 Again, 2 Hard, 3 Good, 4 Easy). */
    rating: integer("rating").notNull(),
    reviewed_at: timestamp("reviewed_at").notNull(),
    duration_ms: integer("duration_ms"),
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
    word_id: text("word_id").references(() => words.id, { onDelete: "cascade" }),
    example_id: text("example_id").references(() => examples.id, { onDelete: "cascade" }),
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
