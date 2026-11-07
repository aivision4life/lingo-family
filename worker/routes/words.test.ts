import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProfileCreate } from "../../shared/profile";
import { LLM_DAILY_QUOTA, wordDetailSchema, wordListSchema, type WordCreate } from "../../shared/word";
import { fakeLlm } from "../test/fakeLlm";
import { createTestEnv, testApp } from "../test/testEnv";

const llm = fakeLlm();
let t: Awaited<ReturnType<typeof createTestEnv>>;
let adultId: string;
let kidId: string;

const profile = (over: Partial<ProfileCreate>): ProfileCreate => ({
  name: "P",
  avatar: "🐻",
  ui_lang: "vi",
  gloss_lang: "vi",
  is_kid: false,
  daily_new_limit: 10,
  study_langs: ["ko"],
  ...over,
});

beforeAll(async () => {
  t = await createTestEnv(testApp({ makeLlm: () => llm.client }));
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["examples", "words", "ai_cache", "usage_daily", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  llm.requests.length = 0;
  adultId = ((await t.api("POST", "/profiles", profile({ name: "Bố" }))).body as { id: string }).id;
  kidId = ((await t.api("POST", "/profiles", profile({ name: "Bé", is_kid: true }))).body as { id: string }).id;
});

const enrich = (term: string, over: object = {}) =>
  t.api("POST", "/words/enrich", { profile_id: adultId, lang: "ko", term, level: "beginner", ...over });

const word = (over: Partial<WordCreate> = {}): WordCreate => ({
  profile_id: adultId,
  lang: "ko",
  term: "학생",
  reading: "haksaeng",
  pos: "noun",
  gloss_vi: "học sinh",
  gloss_en: "student",
  gloss_ko: "배우는 사람",
  hanja: "學生",
  han_viet: "học sinh",
  emoji: "🧑‍🎓",
  ai_generated: true,
  examples: [
    { sentence: "저는 학생이에요.", translation_vi: "Tôi là học sinh.", translation_en: "I am a student.", translation_ko: "", level: "beginner", ai_generated: true },
  ],
  ...over,
});

describe("POST /api/words/enrich", () => {
  it("calls the LLM once, then serves the same request from ai_cache", async () => {
    const first = await enrich("학생");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ cached: false, enrichment: { reading: "haksaeng", han_viet: "học sinh" } });

    const second = await enrich(" 학생 ");
    expect(second.body).toMatchObject({ cached: true });
    expect(llm.requests).toHaveLength(1);

    const usage = await t.env.DB.prepare("SELECT count FROM usage_daily WHERE service = 'llm'").first<{ count: number }>();
    expect(usage?.count).toBe(1);
  });

  it("a different level is a different cache entry", async () => {
    await enrich("학생");
    expect((await enrich("학생", { level: "kid" })).body).toMatchObject({ cached: false });
    expect(llm.requests).toHaveLength(2);
  });

  it("reports duplicates before calling the LLM", async () => {
    const created = await t.api("POST", "/words", word());
    const res = await enrich("학생");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "duplicate_word", existing_id: (created.body as { id: string }).id });
    expect(llm.requests).toHaveLength(0);
  });

  it("forbids kid profiles", async () => {
    expect((await enrich("학생", { profile_id: kidId })).status).toBe(403);
  });

  it("enforces the daily quota on cache misses", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await t.env.DB.prepare("INSERT INTO usage_daily (date, profile_id, service, count) VALUES (?, ?, 'llm', ?)")
      .bind(today, adultId, LLM_DAILY_QUOTA)
      .run();
    const res = await enrich("학교");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "quota_exceeded" });
    expect(llm.requests).toHaveLength(0);
  });

  it("returns 503 when no LLM is configured", async () => {
    const noLlm = await createTestEnv();
    try {
      const p = await noLlm.api("POST", "/profiles", profile({}));
      const res = await noLlm.api("POST", "/words/enrich", {
        profile_id: (p.body as { id: string }).id, lang: "ko", term: "학생", level: "beginner",
      });
      expect(res.status).toBe(503);
    } finally {
      await noLlm.dispose();
    }
  }, 60_000);
});

describe("words CRUD", () => {
  it("creates a word with examples and returns its detail", async () => {
    const created = await t.api("POST", "/words", word());
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    const detail = wordDetailSchema.parse((await t.api("GET", `/words/${id}`)).body);
    expect(detail).toMatchObject({ term: "학생", ai_generated: true, verified: false, hanja: "學生" });
    expect(detail.examples).toHaveLength(1);
  });

  // M7.12: a word added from a TOPIK question remembers where it was met, as data (not a
  // pre-joined label), so each profile's screen can word it in its own language.
  it("keeps where a word was met in TOPIK, and defaults to nowhere", async () => {
    const source = { section: "reading", exam: "8DeOfficial-35회", number: 12 } as const;
    const created = await t.api("POST", "/words", word({ topik_sources: [source] }));
    const id = (created.body as { id: string }).id;
    expect(wordDetailSchema.parse((await t.api("GET", `/words/${id}`)).body).topik_sources).toEqual([source]);

    const plain = await t.api("POST", "/words", word({ term: "학교", hanja: null, han_viet: null, examples: [] }));
    const plainId = (plain.body as { id: string }).id;
    expect(wordDetailSchema.parse((await t.api("GET", `/words/${plainId}`)).body).topik_sources).toEqual([]);
  });

  it("rejects duplicates, case-insensitive for English", async () => {
    await t.api("POST", "/words", word({ lang: "en", term: "Apple", hanja: null, examples: [] }));
    const res = await t.api("POST", "/words", word({ lang: "en", term: "apple ", examples: [] }));
    expect(res.status).toBe(409);
  });

  it("lists and searches by term, reading or gloss, filtered by language", async () => {
    await t.api("POST", "/words", word());
    await t.api("POST", "/words", word({ lang: "en", term: "study", reading: "/ˈstʌd.i/", gloss_vi: "học tập", gloss_en: "to learn", hanja: null, han_viet: null, examples: [] }));

    const all = wordListSchema.parse((await t.api("GET", "/words")).body);
    expect(all).toHaveLength(2);
    expect(wordListSchema.parse((await t.api("GET", "/words?lang=en")).body).map((w) => w.term)).toEqual(["study"]);
    expect(wordListSchema.parse((await t.api("GET", "/words?q=ˈstʌd")).body)).toHaveLength(1);
    expect(wordListSchema.parse((await t.api("GET", "/words?q=học")).body)).toHaveLength(2); // học sinh + học tập
    // LIKE wildcards are matched literally.
    expect(wordListSchema.parse((await t.api("GET", "/words?q=%25")).body)).toHaveLength(0);
  });

  it("forbids kids from adding words and validates input", async () => {
    expect((await t.api("POST", "/words", word({ profile_id: kidId }))).status).toBe(403);
    expect((await t.api("POST", "/words", word({ gloss_vi: " " }))).status).toBe(400);
  });

  it("returns 404 for unknown words", async () => {
    expect((await t.api("GET", "/words/nope")).status).toBe(404);
  });
});
