// Runs the real migration files in order against an in-memory local D1 and checks that
// 0001_remove_zh deletes Chinese data (FK-safe), keeps everything else and renames Hanja.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = path.resolve(import.meta.dirname, "migrations");
let proxy: PlatformProxy<Env>;
let DB: D1Database;

const applied = new Set<string>();

async function apply(file: string) {
  for (const stmt of readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await DB.prepare(stmt).run();
  }
  applied.add(file);
}

/** Brings the schema up to date: applies, in order, every migration no earlier block applied. */
async function applyRemaining() {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (!applied.has(file)) await apply(file);
  }
}

const count = async (sql: string) => (await DB.prepare(sql).first<{ n: number }>())?.n;

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  DB = proxy.env.DB;
  await apply("0000_init.sql");

  const now = Date.now();
  const word = (id: string, lang: string, term: string, simplified: string | null, traditional: string | null) =>
    DB.prepare(
      `INSERT INTO words (id, lang, term, reading, pos, gloss_vi, gloss_en, gloss_ko, hanzi_simplified, hanzi_traditional,
         ai_generated, verified, created_at, updated_at) VALUES (?, ?, ?, '', 'noun', 'x', 'x', 'x', ?, ?, 0, 0, ?, ?)`,
    ).bind(id, lang, term, simplified, traditional, now, now);
  const card = (id: string, wordId: string) =>
    DB.prepare(
      `INSERT INTO cards (id, profile_id, word_id, card_type, due, stability, difficulty, elapsed_days, scheduled_days,
         learning_steps, reps, lapses, state, updated_at) VALUES (?, 'p-zh', ?, 'recognition', ?, 0, 0, 0, 0, 0, 1, 0, 1, ?)`,
    ).bind(id, wordId, now, now);

  await DB.batch([
    DB.prepare(
      `INSERT INTO profiles (id, name, avatar, ui_lang, gloss_lang, is_kid, daily_new_limit, study_langs, created_at)
       VALUES ('p-zh', 'A', '🐻', 'vi', 'vi', 0, 10, '["zh"]', ?), ('p-mix', 'B', '🐼', 'vi', 'vi', 0, 10, '["ko","zh","en"]', ?),
              ('p-ko', 'C', '🦊', 'vi', 'vi', 0, 10, '["ko"]', ?)`,
    ).bind(now, now, now),
    word("w-ko", "ko", "학생", "学生", "學生"),
    word("w-zh", "zh", "学习", "学习", "學習"),
    DB.prepare(
      `INSERT INTO examples (id, word_id, sentence, translation_vi, translation_en, translation_ko, level, ai_generated)
       VALUES ('e-ko', 'w-ko', 's', '', '', '', 'beginner', 0), ('e-zh', 'w-zh', 's', '', '', '', 'beginner', 0)`,
    ),
    DB.prepare(
      `INSERT INTO decks (id, name, lang, is_kid_deck, created_at)
       VALUES ('default-ko', 'default-ko', 'ko', 0, ?), ('default-zh', 'default-zh', 'zh', 0, ?)`,
    ).bind(now, now),
    DB.prepare("INSERT INTO deck_words (deck_id, word_id) VALUES ('default-ko', 'w-ko'), ('default-zh', 'w-zh')"),
    DB.prepare("INSERT INTO profile_decks (profile_id, deck_id) VALUES ('p-zh', 'default-zh'), ('p-mix', 'default-ko')"),
    card("c-ko", "w-ko"),
    card("c-zh", "w-zh"),
    DB.prepare(
      `INSERT INTO review_logs (id, card_id, profile_id, rating, reviewed_at, state, due, stability, difficulty,
         elapsed_days, last_elapsed_days, scheduled_days, learning_steps)
       VALUES ('l-ko', 'c-ko', 'p-zh', 3, ?, 0, ?, 0, 0, 0, 0, 0, 0), ('l-zh', 'c-zh', 'p-zh', 3, ?, 0, ?, 0, 0, 0, 0, 0, 0)`,
    ).bind(now, now, now, now),
    DB.prepare("INSERT INTO ai_cache (key, response_json, created_at) VALUES ('k', '{}', ?)").bind(now),
  ]);

  await apply("0001_remove_zh.sql");
}, 60_000);

afterAll(() => proxy.dispose());

describe("migration 0001_remove_zh", () => {
  it("deletes zh rows and nothing else", async () => {
    expect(await count("SELECT count(*) AS n FROM words WHERE lang = 'zh'")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM decks WHERE id = 'default-zh'")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM examples WHERE id = 'e-zh'")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM cards WHERE id = 'c-zh'")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM review_logs WHERE id = 'l-zh'")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM deck_words WHERE deck_id = 'default-zh'")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM profile_decks WHERE deck_id = 'default-zh'")).toBe(0);
    // Korean data is untouched.
    expect(await count("SELECT count(*) AS n FROM words WHERE id = 'w-ko'")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM review_logs WHERE id = 'l-ko'")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM examples WHERE id = 'e-ko'")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM ai_cache")).toBe(0);
  });

  it("removes zh from study_langs (a profile left empty gets Korean)", async () => {
    const rows = await DB.prepare("SELECT id, study_langs FROM profiles ORDER BY id").all<{ id: string; study_langs: string }>();
    expect(Object.fromEntries(rows.results.map((r) => [r.id, JSON.parse(r.study_langs)]))).toEqual({
      "p-ko": ["ko"],
      "p-mix": ["ko", "en"],
      "p-zh": ["ko"],
    });
  });

  it("renames hanzi_traditional to hanja and drops hanzi_simplified", async () => {
    const cols = await DB.prepare("SELECT name FROM pragma_table_info('words')").all<{ name: string }>();
    const names = cols.results.map((c) => c.name);
    expect(names).toContain("hanja");
    expect(names).not.toContain("hanzi_traditional");
    expect(names).not.toContain("hanzi_simplified");
    expect(await DB.prepare("SELECT hanja FROM words WHERE id = 'w-ko'").first("hanja")).toBe("學生");
  });

  it("keys han_chars by Hanja", async () => {
    const cols = await DB.prepare("SELECT name, pk FROM pragma_table_info('han_chars')").all<{ name: string; pk: number }>();
    expect(cols.results.find((c) => c.pk === 1)?.name).toBe("hanja");
    const wc = await DB.prepare("SELECT name FROM pragma_table_info('word_chars')").all<{ name: string }>();
    expect(wc.results.map((c) => c.name)).toEqual(["word_id", "position", "hanja"]);
  });
});

describe("migration 0002_phrases", () => {
  let logsBefore: number | undefined;

  beforeAll(async () => {
    logsBefore = await count("SELECT count(*) AS n FROM review_logs");
    await apply("0002_phrases.sql");
  });

  it("keeps every review log and backfills lang from the card's word", async () => {
    expect(logsBefore).toBe(1);
    expect(await count("SELECT count(*) AS n FROM review_logs")).toBe(logsBefore);
    expect(await DB.prepare("SELECT lang FROM review_logs WHERE id = 'l-ko'").first("lang")).toBe("ko");
  });

  it("creates the hand-written triggers", async () => {
    const rows = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual([
      "cards_phrase_root_insert",
      "cards_phrase_root_update",
      "examples_phrase_root_insert",
      "examples_phrase_root_update",
      "phrases_root_fixed",
    ]);
  });

  describe("triggers and cascades", () => {
    const now = Date.now();
    const addPhrase = (id: string, wordId: string, text: string) =>
      DB.prepare(
        `INSERT INTO phrases (id, word_id, lang, text, reading, gloss_vi, gloss_en, gloss_ko, ai_generated, verified, created_at, updated_at)
         VALUES (?, ?, 'ko', ?, '', 'x', 'x', 'x', 0, 0, ?, ?)`,
      ).bind(id, wordId, text, now, now).run();
    const addCard = (id: string, wordId: string, phraseId: string | null, type = "recognition") =>
      DB.prepare(
        `INSERT INTO cards (id, profile_id, word_id, phrase_id, card_type, due, stability, difficulty, elapsed_days,
           scheduled_days, learning_steps, reps, lapses, state, updated_at)
         VALUES (?, 'p-ko', ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
      ).bind(id, wordId, phraseId, type, now, now).run();

    beforeAll(async () => {
      const t2 = Date.now();
      await DB.prepare(
        `INSERT INTO words (id, lang, term, reading, pos, gloss_vi, gloss_en, gloss_ko, ai_generated, verified, created_at, updated_at)
         VALUES ('w-ko2', 'ko', '학교', '', 'noun', 'x', 'x', 'x', 0, 0, ?, ?)`,
      ).bind(t2, t2).run();
      await addPhrase("ph-1", "w-ko", "대학생");
    });

    it("rejects a phrase row whose word_id is not the phrase's root word", async () => {
      await expect(addCard("c-bad", "w-ko2", "ph-1")).rejects.toThrow(/root word/);
      await expect(
        DB.prepare(
          `INSERT INTO examples (id, word_id, phrase_id, sentence, translation_vi, translation_en, translation_ko, level, ai_generated)
           VALUES ('e-bad', 'w-ko2', 'ph-1', 's', '', '', '', 'beginner', 0)`,
        ).run(),
      ).rejects.toThrow(/root word/);
      await expect(DB.prepare("UPDATE phrases SET word_id = 'w-ko2' WHERE id = 'ph-1'").run()).rejects.toThrow(/cannot change/);
    });

    it("allows a word card and a phrase card of the same type, but no duplicate phrase card", async () => {
      await addCard("c-ph", "w-ko", "ph-1"); // c-ko (word card, recognition) already exists
      await expect(addCard("c-ph-dup", "w-ko", "ph-1")).rejects.toThrow(/UNIQUE/);
    });

    it("deleting the root word removes phrases and their cards, but keeps review logs (card_id → NULL)", async () => {
      await DB.prepare(
        `INSERT INTO review_logs (id, card_id, profile_id, rating, reviewed_at, lang, state, due, stability, difficulty,
           elapsed_days, last_elapsed_days, scheduled_days, learning_steps)
         VALUES ('l-ph', 'c-ph', 'p-ko', 3, ?, 'ko', 0, ?, 0, 0, 0, 0, 0, 0)`,
      ).bind(now, now).run();
      await DB.prepare("DELETE FROM words WHERE id = 'w-ko'").run();
      expect(await count("SELECT count(*) AS n FROM phrases WHERE id = 'ph-1'")).toBe(0);
      expect(await count("SELECT count(*) AS n FROM cards WHERE word_id = 'w-ko'")).toBe(0);
      const logs = await DB.prepare("SELECT id, card_id, lang FROM review_logs WHERE id IN ('l-ko', 'l-ph') ORDER BY id").all();
      expect(logs.results).toEqual([
        { id: "l-ko", card_id: null, lang: "ko" },
        { id: "l-ph", card_id: null, lang: "ko" },
      ]);
    });
  });
});

describe("migrations 0003_ai_cache_model and 0004_images", () => {
  beforeAll(async () => {
    await apply("0003_ai_cache_model.sql");
    await apply("0004_images.sql");
  });

  it("keeps existing rows; old words, phrases and examples start with image_status 'none'", async () => {
    expect(await count("SELECT count(*) AS n FROM words")).toBe(1); // w-ko2 (w-ko was deleted in the 0002 cascade test)
    for (const table of ["words", "phrases", "examples"]) {
      const bad = await count(`SELECT count(*) AS n FROM ${table} WHERE image_status != 'none' OR image_key IS NOT NULL`);
      expect(bad).toBe(0);
    }
    const cols = await DB.prepare("SELECT name FROM pragma_table_info('examples') WHERE name LIKE 'image_%' ORDER BY name").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toEqual([
      "image_key", "image_model", "image_nonce", "image_prompt", "image_requested_at", "image_source", "image_status",
    ]);
    expect(await count("SELECT count(*) AS n FROM pragma_table_info('ai_cache') WHERE name = 'model'")).toBe(1);
  });

  it("keeps the phrase triggers (no table was rebuilt)", async () => {
    expect(await count("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'")).toBe(5);
  });
});

describe("migration 0005_albums", () => {
  let beforeRows: number;
  beforeAll(async () => {
    beforeRows = (await count("SELECT count(*) AS n FROM deck_words")) ?? 0;
    await apply("0005_albums.sql");
  });

  const insertWord = (id: string, lang: string, term: string) =>
    DB.prepare(
      `INSERT INTO words (id, lang, term, reading, pos, gloss_vi, gloss_en, gloss_ko, ai_generated, verified, created_at, updated_at)
       VALUES (?, ?, ?, '', 'noun', 'x', 'x', 'x', 0, 0, 1, 1)`,
    ).bind(id, lang, term);

  it("existing decks become 'default' and existing links keep their rows with a backfilled added_at", async () => {
    expect(await count("SELECT count(*) AS n FROM decks WHERE kind != 'default'")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM deck_words")).toBe(beforeRows);
    expect(await count("SELECT count(*) AS n FROM deck_words WHERE added_at = 0")).toBe(0);
  });

  it("a new link left at added_at = 0 gets the insert time; an explicit value is kept", async () => {
    await DB.batch([
      insertWord("w-al-1", "ko", "앨범1"),
      insertWord("w-al-2", "ko", "앨범2"),
      DB.prepare("INSERT INTO decks (id, name, lang, kind, created_at) VALUES ('alb-ko', 'Office', 'ko', 'album', 1)"),
    ]);
    const before = Date.now();
    await DB.prepare("INSERT INTO deck_words (deck_id, word_id) VALUES ('alb-ko', 'w-al-1')").run();
    await DB.prepare("INSERT INTO deck_words (deck_id, word_id, added_at) VALUES ('alb-ko', 'w-al-2', 12345)").run();
    const rows = await DB.prepare("SELECT word_id, added_at FROM deck_words WHERE deck_id = 'alb-ko' ORDER BY word_id").all<{ word_id: string; added_at: number }>();
    expect(rows.results[0]!.added_at).toBeGreaterThanOrEqual(before - 1000);
    expect(rows.results[1]!.added_at).toBe(12345);
  });

  it("a word cannot join a deck of another language", async () => {
    await insertWord("w-al-en", "en", "album-en").run();
    await expect(DB.prepare("INSERT INTO deck_words (deck_id, word_id) VALUES ('alb-ko', 'w-al-en')").run()).rejects.toThrow(/languages differ/);
  });

  it("deleting an album removes only its links; deleting a word removes it from albums", async () => {
    await DB.prepare("DELETE FROM decks WHERE id = 'alb-ko'").run();
    expect(await count("SELECT count(*) AS n FROM deck_words WHERE deck_id = 'alb-ko'")).toBe(0);
    expect(await count("SELECT count(*) AS n FROM words WHERE id IN ('w-al-1', 'w-al-2')")).toBe(2);
  });

  it("adds the two triggers and keeps the earlier ones", async () => {
    expect(await count("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'")).toBe(7);
  });
});

describe("migration 0006_pron_attempts_set_null", () => {
  const attempt = (id: string, over: { word?: string | null; phrase?: string | null; example?: string | null } = {}) =>
    DB.prepare(
      `INSERT INTO pron_attempts (id, profile_id, word_id, phrase_id, example_id, lang, reference_text, pron_score, accuracy, fluency, completeness, created_at)
       VALUES (?, 'p-ko', ?, ?, ?, 'ko', ?, 80, 80, 80, 100, 1)`,
    ).bind(id, over.word ?? null, over.phrase ?? null, over.example ?? null, `text of ${id}`);

  beforeAll(async () => {
    // Rows written before the rebuild must survive it (in production the table is empty).
    await DB.batch([
      DB.prepare(
        `INSERT INTO words (id, lang, term, reading, pos, gloss_vi, gloss_en, gloss_ko, ai_generated, verified, created_at, updated_at)
         VALUES ('w-pa', 'ko', '연습', '', 'noun', 'x', 'x', 'x', 0, 0, 1, 1)`,
      ),
      DB.prepare(
        `INSERT INTO phrases (id, word_id, lang, text, reading, gloss_vi, gloss_en, gloss_ko, ai_generated, verified, created_at, updated_at)
         VALUES ('ph-pa', 'w-pa', 'ko', '연습장', 'x', 'x', 'x', 'x', 0, 0, 1, 1)`,
      ),
      DB.prepare(
        `INSERT INTO examples (id, word_id, sentence, translation_vi, translation_en, translation_ko, level, ai_generated)
         VALUES ('ex-pa', 'w-pa', '연습해요', '', '', '', 'beginner', 0)`,
      ),
      attempt("a-word", { word: "w-pa" }),
      attempt("a-phrase", { word: "w-pa", phrase: "ph-pa" }),
      attempt("a-example", { word: "w-pa", example: "ex-pa" }),
    ]);
    await apply("0006_pron_attempts_set_null.sql");
  });

  it("keeps every existing attempt with its scores and links", async () => {
    expect(await count("SELECT count(*) AS n FROM pron_attempts")).toBe(3);
    const row = await DB.prepare("SELECT word_id, example_id, reference_text, pron_score FROM pron_attempts WHERE id = 'a-example'").first();
    expect(row).toEqual({ word_id: "w-pa", example_id: "ex-pa", reference_text: "text of a-example", pron_score: 80 });
  });

  it("deleting an example, a phrase or a word keeps the attempts; their link becomes NULL", async () => {
    await DB.prepare("DELETE FROM examples WHERE id = 'ex-pa'").run();
    await DB.prepare("DELETE FROM phrases WHERE id = 'ph-pa'").run();
    expect(await count("SELECT count(*) AS n FROM pron_attempts")).toBe(3);
    expect(await count("SELECT count(*) AS n FROM pron_attempts WHERE example_id IS NOT NULL OR phrase_id IS NOT NULL")).toBe(0);

    await DB.prepare("DELETE FROM words WHERE id = 'w-pa'").run();
    expect(await count("SELECT count(*) AS n FROM pron_attempts")).toBe(3);
    expect(await count("SELECT count(*) AS n FROM pron_attempts WHERE word_id IS NOT NULL")).toBe(0);
    // The history stays readable.
    const texts = await DB.prepare("SELECT reference_text FROM pron_attempts ORDER BY id").all<{ reference_text: string }>();
    expect(texts.results.map((r) => r.reference_text)).toEqual(["text of a-example", "text of a-phrase", "text of a-word"]);
  });

  it("deleting a profile still deletes its attempts; indexes and triggers are intact", async () => {
    await DB.batch([DB.prepare("DELETE FROM profiles WHERE id = 'p-ko'")]);
    expect(await count("SELECT count(*) AS n FROM pron_attempts")).toBe(0);
    expect(
      await count("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name IN ('pron_attempts_profile_time_idx', 'pron_attempts_word_idx')"),
    ).toBe(2);
    expect(await count("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger'")).toBe(7);
  });
});

describe("migration 0007_library_scope_indexes", () => {
  beforeAll(async () => {
    await apply("0007_library_scope_indexes.sql");
  });

  it("adds the two indexes without touching data", async () => {
    const names = (
      await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('cards_profile_word_idx', 'words_created_by_idx')").all<{
        name: string;
      }>()
    ).results.map((r) => r.name);
    expect(names.sort()).toEqual(["cards_profile_word_idx", "words_created_by_idx"]);
  });
});

describe("migration 0014_topik_listening_audio", () => {
  beforeAll(async () => {
    await applyRemaining();
    const now = Date.now();
    await DB.prepare(
      `INSERT INTO topik_questions (id, section, exam, number, block, options, correct_option, verified, created_at, updated_at)
       VALUES ('q-l1', 'listening', 'Test-60회', 1, '1~3', '[]', 1, 1, ?, ?)`,
    ).bind(now, now).run();
    await DB.prepare(
      "INSERT INTO topik_audio (id, section, exam, audio_key, duration_ms, verified, created_at, updated_at) VALUES ('a-1', 'listening', 'Test-60회', 'topik/audio/x.mp3', 600000, 0, ?, ?)",
    ).bind(now, now).run();
    await DB.prepare(
      "INSERT INTO topik_segments (id, audio_id, idx, start_ms, speech_end_ms, end_ms, created_at) VALUES ('s-1', 'a-1', 1, 1000, 20000, 26000, ?)",
    ).bind(now).run();
    await DB.prepare("UPDATE topik_questions SET segment_id = 's-1' WHERE id = 'q-l1'").run();
  });

  it("stores one audio per exam and refuses a duplicate", async () => {
    const now = Date.now();
    await expect(
      DB.prepare(
        "INSERT INTO topik_audio (id, section, exam, audio_key, duration_ms, verified, created_at, updated_at) VALUES ('a-dup', 'listening', 'Test-60회', 'topik/audio/y.mp3', 1, 0, ?, ?)",
      ).bind(now, now).run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("lets several questions share one segment", async () => {
    const now = Date.now();
    await DB.prepare(
      `INSERT INTO topik_questions (id, section, exam, number, block, options, correct_option, verified, segment_id, created_at, updated_at)
       VALUES ('q-l2', 'listening', 'Test-60회', 2, '1~3', '[]', 2, 1, 's-1', ?, ?)`,
    ).bind(now, now).run();
    expect(await count("SELECT count(*) AS n FROM topik_questions WHERE segment_id = 's-1'")).toBe(2);
  });

  // Re-cutting an exam must never cost review history: the questions stay, only the link drops.
  it("deleting a segment keeps its questions and clears their link", async () => {
    await DB.prepare("DELETE FROM topik_segments WHERE id = 's-1'").run();
    expect(await count("SELECT count(*) AS n FROM topik_questions WHERE id IN ('q-l1', 'q-l2')")).toBe(2);
    expect(await count("SELECT count(*) AS n FROM topik_questions WHERE segment_id IS NOT NULL")).toBe(0);
  });

  it("deleting the audio takes its segments with it", async () => {
    const now = Date.now();
    await DB.prepare(
      "INSERT INTO topik_segments (id, audio_id, idx, start_ms, speech_end_ms, end_ms, created_at) VALUES ('s-2', 'a-1', 2, 26000, 40000, 44000, ?)",
    ).bind(now).run();
    await DB.prepare("DELETE FROM topik_audio WHERE id = 'a-1'").run();
    expect(await count("SELECT count(*) AS n FROM topik_segments")).toBe(0);
  });
});

describe("migration 0019_topik_test_clock", () => {
  beforeAll(async () => {
    await applyRemaining();
    await DB.prepare(
      `INSERT INTO profiles (id, name, avatar, ui_lang, gloss_lang, is_kid, daily_new_limit, study_langs, created_at)
       VALUES ('p-sit', 'D', '🐯', 'vi', 'vi', 0, 10, '["ko"]', ?)`,
    ).bind(Date.now()).run();
  });

  it("gives a sitting the clock columns", async () => {
    const now = Date.now();
    await DB.prepare(
      `INSERT INTO topik_tests (id, profile_id, section, kind, question_count, total_points, status, started_at,
         length_ms, ends_at, paused_at, auto_submitted, pause_count, paused_ms, created_at)
       VALUES ('t-clock', 'p-sit', 'reading', 'original', 2, 4, 'running', ?, 120000, ?, NULL, 0, 0, 0, ?)`,
    ).bind(now, now + 120_000, now).run();
    const row = await DB.prepare("SELECT length_ms, ends_at, auto_submitted FROM topik_tests WHERE id = 't-clock'").first<{
      length_ms: number;
      ends_at: number;
      auto_submitted: number;
    }>();
    expect(row).toMatchObject({ length_ms: 120_000, auto_submitted: 0 });
    expect(row!.ends_at).toBe(now + 120_000);
  });

  // The data fix in the file itself: five sittings on production had been `running` — and therefore
  // still answerable — for days, with no deadline to measure them by. Re-run here on a row of the
  // same shape, taking the statement from the migration rather than a copy of it.
  it("ends the deadline-less sittings it inherited", async () => {
    const now = Date.now();
    await DB.prepare(
      `INSERT INTO topik_tests (id, profile_id, section, kind, question_count, total_points, status, started_at, pause_count, paused_ms, created_at)
       VALUES ('t-stuck', 'p-sit', 'reading', 'original', 18, 36, 'running', ?, 0, 0, ?)`,
    ).bind(now - 5 * 24 * 60 * 60_000, now).run();
    await DB.prepare(
      `INSERT INTO topik_tests (id, profile_id, section, kind, question_count, total_points, status, started_at,
         length_ms, ends_at, pause_count, paused_ms, created_at)
       VALUES ('t-live', 'p-sit', 'reading', 'original', 18, 36, 'running', ?, 1500000, ?, 0, 0, ?)`,
    ).bind(now, now + 1_500_000, now).run();

    const sql = readFileSync(path.join(dir, "0019_topik_test_clock.sql"), "utf8")
      .split("--> statement-breakpoint")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.startsWith("UPDATE") || stmt.includes("\nUPDATE"));
    expect(sql).toHaveLength(1);
    await DB.prepare(sql[0]!).run();

    const stuck = await DB.prepare("SELECT status FROM topik_tests WHERE id = 't-stuck'").first<{ status: string }>();
    const live = await DB.prepare("SELECT status FROM topik_tests WHERE id = 't-live'").first<{ status: string }>();
    expect(stuck!.status).toBe("abandoned");
    // A sitting that has a deadline is one someone can still come back to: left alone.
    expect(live!.status).toBe("running");
  });
});

describe("migration 0020_topik_test_range", () => {
  beforeAll(async () => {
    await applyRemaining();
  });

  // The range is the sitting's intention, so it is stored — but the sittings that already existed
  // have only their items to say what they covered. Backfilled, so the history has one shape.
  it("backfills the range of a sitting drawn before ranges existed", async () => {
    const now = Date.now();
    await DB.prepare(
      `INSERT INTO topik_tests (id, profile_id, section, kind, question_count, total_points, status, started_at, pause_count, paused_ms, created_at)
       VALUES ('t-old', 'p-sit', 'listening', 'original', 3, 6, 'finished', ?, 0, 0, ?)`,
    ).bind(now, now).run();
    for (const [position, number] of [[21, 21], [22, 22], [23, 23]]) {
      await DB.prepare(
        `INSERT INTO topik_test_items (id, test_id, position, number, points)
         VALUES (?, 't-old', ?, ?, 2)`,
      ).bind(`i-${number}`, position, number).run();
    }
    expect(await count("SELECT count(*) AS n FROM topik_tests WHERE id = 't-old' AND from_number IS NULL")).toBe(1);

    const sql = readFileSync(path.join(dir, "0020_topik_test_range.sql"), "utf8")
      .split("--> statement-breakpoint")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.includes("UPDATE"));
    expect(sql).toHaveLength(1);
    await DB.prepare(sql[0]!).run();

    const row = await DB.prepare("SELECT from_number, to_number FROM topik_tests WHERE id = 't-old'").first<{
      from_number: number;
      to_number: number;
    }>();
    expect(row).toEqual({ from_number: 21, to_number: 23 });
  });

  it("leaves a sitting with no items at all alone, rather than writing nonsense", async () => {
    const now = Date.now();
    await DB.prepare(
      `INSERT INTO topik_tests (id, profile_id, section, kind, question_count, total_points, status, started_at, pause_count, paused_ms, created_at)
       VALUES ('t-empty', 'p-sit', 'listening', 'original', 0, 0, 'abandoned', ?, 0, 0, ?)`,
    ).bind(now, now).run();
    const sql = readFileSync(path.join(dir, "0020_topik_test_range.sql"), "utf8")
      .split("--> statement-breakpoint")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.includes("UPDATE"));
    await DB.prepare(sql[0]!).run();
    expect(await count("SELECT count(*) AS n FROM topik_tests WHERE id = 't-empty' AND from_number IS NULL")).toBe(1);
  });
});
