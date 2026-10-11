// AI help for sentences / phrases typed by hand (M2.6): schema, cache, quota, suggestion, kids.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enrichPhraseResponseSchema, enrichSentenceResponseSchema } from "../../shared/customItem";
import { LLM_DAILY_QUOTA } from "../../shared/word";
import { usageDate } from "../lib/quota";
import { fakeLlm } from "../test/fakeLlm";
import { createTestEnv, testApp } from "../test/testEnv";
import { finalizeSentenceCheck } from "../services/customItem";

const raw = (over: Record<string, unknown> = {}) => ({
  translation_vi: "Tôi là học sinh.",
  translation_en: "I am a student.",
  translation_ko: "x",
  image_prompt: "A child with a backpack standing in front of a school",
  contains_word: true,
  suggestion: "",
  suggestion_translation_vi: "",
  suggestion_translation_en: "",
  suggestion_translation_ko: "",
  suggestion_image_prompt: "",
  note_vi: "",
  ...over,
});
const phraseRaw = (over: Record<string, unknown> = {}) => ({
  reading: "daehaksaeng",
  gloss_vi: "sinh viên",
  gloss_en: "university student",
  gloss_ko: "대학에 다니는 학생",
  image_prompt: "A young adult carrying books on a campus",
  contains_word: true,
  ...over,
});

const llm = fakeLlm();
let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult: string;
let kid: string;

const profile = (name: string, is_kid: boolean) => ({
  name, avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid, daily_new_limit: 5, study_langs: ["ko"],
});
const sentence = (text = "저는 학생이에요.", lang = "ko") =>
  t.api("POST", "/enrich/sentence", { profile_id: adult, lang, text, word_term: "학생", word_gloss: "học sinh" });
const llmUsage = async () =>
  (await t.env.DB.prepare("SELECT count FROM usage_daily WHERE profile_id = ? AND service = 'llm'").bind(adult).first<{ count: number }>())?.count ?? 0;

beforeAll(async () => {
  t = await createTestEnv(testApp({ makeLlm: () => llm.client }));
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["ai_cache", "usage_daily", "profiles"]) await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  llm.requests.length = 0;
  adult = ((await t.api("POST", "/profiles", profile("Bố", false))).body as { id: string }).id;
  kid = ((await t.api("POST", "/profiles", profile("Bé", true))).body as { id: string }).id;
});

const answer = (json: object) => {
  // fakeLlm repeats its last output: replace it for the next calls.
  llm.client.generate = async (req) => (llm.requests.push(req), { text: JSON.stringify(json), model: "fake-model" });
};

describe("POST /api/enrich/sentence", () => {
  it("translates, writes an image prompt, and leaves the sentence's own language empty", async () => {
    answer(raw());
    const res = await sentence();
    expect(res.status).toBe(200);
    const { check, cached } = enrichSentenceResponseSchema.parse(res.body);
    expect(cached).toBe(false);
    expect(check.sentence).toMatchObject({
      text: "저는 학생이에요.",
      translation_vi: "Tôi là học sinh.",
      translation_en: "I am a student.",
      translation_ko: "", // Korean sentence: never translated into Korean
    });
    expect(check.sentence.image_prompt).toMatch(/school/);
    expect(check.contains_word).toBe(true);
    expect(check.suggestion).toBeNull();
    expect(check.note_vi).toBeNull();
    // The prompt carries the root word, its meaning, the language and the image rules.
    const req = llm.requests[0]!;
    expect(req.user).toContain("학생");
    expect(req.user).toContain("học sinh");
    expect(req.system).toContain("image_prompt");
  });

  it("an English sentence leaves translation_en empty", async () => {
    answer(raw({ translation_en: "should be dropped", translation_ko: "나는 학생입니다." }));
    const { check } = enrichSentenceResponseSchema.parse((await sentence("I am a student.", "en")).body);
    expect(check.sentence).toMatchObject({ translation_en: "", translation_ko: "나는 학생입니다." });
  });

  it("returns a suggestion with its own translations and image prompt, plus a short Vietnamese reason", async () => {
    answer(
      raw({
        suggestion: "저는 학생입니다.",
        suggestion_translation_vi: "Tôi là học sinh (lịch sự).",
        suggestion_translation_en: "I am a student (polite).",
        suggestion_translation_ko: "ignored",
        suggestion_image_prompt: "A smiling child introducing themselves at school",
        note_vi: "Nên dùng đuôi câu lịch sự.",
      }),
    );
    const { check } = enrichSentenceResponseSchema.parse((await sentence("나는 학생이다 요.")).body);
    expect(check.suggestion).toMatchObject({
      text: "저는 학생입니다.",
      translation_vi: "Tôi là học sinh (lịch sự).",
      translation_ko: "",
      image_prompt: "A smiling child introducing themselves at school",
    });
    expect(check.note_vi).toBe("Nên dùng đuôi câu lịch sự.");
  });

  it("reports when the sentence does not contain the root word", async () => {
    answer(raw({ contains_word: false }));
    expect(enrichSentenceResponseSchema.parse((await sentence()).body).check.contains_word).toBe(false);
  });

  it("is cached: the second call costs no LLM call and no quota", async () => {
    answer(raw());
    await sentence();
    expect(await llmUsage()).toBe(1);
    const again = enrichSentenceResponseSchema.parse((await sentence()).body);
    expect(again.cached).toBe(true);
    expect(llm.requests).toHaveLength(1);
    expect(await llmUsage()).toBe(1);
    // A different sentence is a different request.
    await sentence("학생이 많아요.");
    expect(llm.requests).toHaveLength(2);
  });

  it("stops at the daily LLM quota (429) and does not call the model", async () => {
    await t.env.DB.prepare("INSERT INTO usage_daily (date, profile_id, service, count) VALUES (?, ?, 'llm', ?)").bind(usageDate(), adult, LLM_DAILY_QUOTA).run();
    answer(raw());
    expect((await sentence()).status).toBe(429);
    expect(llm.requests).toHaveLength(0);
  });

  it("retries once on invalid JSON, then reports invalid output", async () => {
    llm.client.generate = async (req) => (llm.requests.push(req), { text: JSON.stringify({ translation_vi: 1 }), model: "fake-model" });
    expect((await sentence()).status).toBe(502);
    expect(llm.requests).toHaveLength(2); // one try + one retry with the problems appended
  });

  it("kid profiles are refused; bad input is rejected", async () => {
    answer(raw());
    const res = await t.api("POST", "/enrich/sentence", { profile_id: kid, lang: "ko", text: "저는 학생이에요.", word_term: "학생", word_gloss: "" });
    expect(res.status).toBe(403);
    expect((await sentence("")).status).toBe(400);
    expect((await sentence("가".repeat(201))).status).toBe(400);
    expect(llm.requests).toHaveLength(0);
  });
});

describe("POST /api/enrich/phrase", () => {
  const phrase = (text = "대학생", profile_id = adult) =>
    t.api("POST", "/enrich/phrase", { profile_id, lang: "ko", text, word_term: "학생", word_gloss: "học sinh" });

  it("fills reading, the three glosses and the image prompt; cached afterwards", async () => {
    llm.client.generate = async (req) => (llm.requests.push(req), { text: JSON.stringify(phraseRaw()), model: "fake-model" });
    const { fill, cached } = enrichPhraseResponseSchema.parse((await phrase()).body);
    expect(cached).toBe(false);
    expect(fill).toMatchObject({ text: "대학생", reading: "daehaksaeng", gloss_vi: "sinh viên", gloss_en: "university student", contains_word: true });
    expect(enrichPhraseResponseSchema.parse((await phrase()).body).cached).toBe(true);
    expect(llm.requests).toHaveLength(1);
  });

  it("kid profiles are refused", async () => {
    expect((await phrase("대학생", kid)).status).toBe(403);
  });
});

describe("finalizeSentenceCheck", () => {
  it("drops a 'suggestion' that equals the sentence, or has no image prompt, and its note with it", () => {
    const same = finalizeSentenceCheck("ko", "저는 학생이에요.", raw({ suggestion: "  저는  학생이에요. ", suggestion_image_prompt: "A long enough prompt here", note_vi: "x" }) as never);
    expect(same.suggestion).toBeNull();
    expect(same.note_vi).toBeNull();
    const noPrompt = finalizeSentenceCheck("ko", "a", raw({ suggestion: "b", suggestion_image_prompt: "", note_vi: "x" }) as never);
    expect(noPrompt.suggestion).toBeNull();
  });
});
