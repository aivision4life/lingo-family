import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../env";
import { createTestEnv } from "../test/testEnv";
import { supportedStudyLangs, syncProfileCards } from "./review";

describe("supportedStudyLangs", () => {
  it("keeps only ko/en, in a fixed order", () => {
    expect(supportedStudyLangs(["en", "zh", "ko"])).toEqual(["ko", "en"]);
    expect(supportedStudyLangs(["zh", "ja", 1, null])).toEqual([]);
  });
});

describe("syncProfileCards with leftover unsupported data", () => {
  let t: Awaited<ReturnType<typeof createTestEnv>>;
  beforeAll(async () => {
    t = await createTestEnv();
  }, 60_000);
  afterAll(() => t.dispose());

  it("never creates a deck, deck link or card for a language other than ko/en", async () => {
    const DB = t.env.DB;
    const now = Date.now();
    // Simulate data from before M1.6: a profile still listing "zh" and a "zh" word.
    await DB.batch([
      DB.prepare(
        `INSERT INTO profiles (id, name, avatar, ui_lang, gloss_lang, is_kid, daily_new_limit, study_langs, created_at)
         VALUES ('p1', 'Bố', '🐻', 'vi', 'vi', 0, 10, '["ko","zh","en"]', ?)`,
      ).bind(now),
      ...[
        ["w-ko", "ko", "학생"],
        ["w-zh", "zh", "学生"],
        ["w-en", "en", "student"],
      ].map(([id, lang, term]) =>
        DB.prepare(
          `INSERT INTO words (id, lang, term, reading, pos, gloss_vi, gloss_en, gloss_ko, ai_generated, verified, created_at, updated_at)
           VALUES (?, ?, ?, '', 'noun', 'x', 'x', 'x', 0, 0, ?, ?)`,
        ).bind(id, lang, term, now, now),
      ),
    ]);

    // Must not throw (a "zh" deck link would violate the decks foreign key).
    await syncProfileCards(getDb(t.env), DB, "p1", new Date(now));

    const decks = await DB.prepare("SELECT id FROM decks ORDER BY id").all<{ id: string }>();
    expect(decks.results.map((d) => d.id)).toEqual(["default-en", "default-ko"]);
    const links = await DB.prepare("SELECT deck_id FROM profile_decks WHERE profile_id = 'p1' ORDER BY deck_id").all<{ deck_id: string }>();
    expect(links.results.map((l) => l.deck_id)).toEqual(["default-en", "default-ko"]);
    const deckWords = await DB.prepare("SELECT word_id FROM deck_words ORDER BY word_id").all<{ word_id: string }>();
    expect(deckWords.results.map((d) => d.word_id)).toEqual(["w-en", "w-ko"]);
    const zhCards = await DB.prepare("SELECT count(*) AS n FROM cards WHERE word_id = 'w-zh'").first<{ n: number }>();
    expect(zhCards?.n).toBe(0);
    const cards = await DB.prepare("SELECT count(*) AS n FROM cards WHERE profile_id = 'p1'").first<{ n: number }>();
    expect(cards?.n).toBe(6); // 2 words (ko, en) × 3 card types (recognition, listening, speaking)
  });
});
