import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProfileCreate } from "../../shared/profile";
import { TTS_DAILY_QUOTA, wordCreatedSchema, wordDetailSchema, type WordCreate } from "../../shared/word";
import { fakeTts } from "../test/fakeTts";
import { createTestEnv, testApp } from "../test/testEnv";

const tts = fakeTts();
let t: Awaited<ReturnType<typeof createTestEnv>>;
let adultId: string;

const adult: ProfileCreate = {
  name: "Bố",
  avatar: "🐻",
  ui_lang: "vi",
  gloss_lang: "vi",
  is_kid: false,
  daily_new_limit: 10,
  study_langs: ["ko"],
};

const example = (sentence: string) => ({
  sentence,
  translation_vi: "vi",
  translation_en: "en",
  translation_ko: "",
  level: "beginner" as const,
  ai_generated: true,
});

const word = (over: Partial<WordCreate> = {}): WordCreate => ({
  profile_id: adultId,
  lang: "ko",
  term: "학생",
  reading: "haksaeng",
  pos: "noun",
  gloss_vi: "học sinh",
  gloss_en: "student",
  gloss_ko: "배우는 사람",
  hanzi_simplified: null,
  hanzi_traditional: null,
  han_viet: null,
  emoji: null,
  ai_generated: false,
  examples: [example("저는 학생이에요."), example("학생이 많아요.")],
  ...over,
});

const createWord = async (over: Partial<WordCreate> = {}) => {
  const res = await t.api("POST", "/words", word(over));
  expect(res.status).toBe(201);
  return wordCreatedSchema.parse(res.body);
};
const detail = async (id: string) => wordDetailSchema.parse((await t.api("GET", `/words/${id}`)).body);
const ttsUsage = async () =>
  (await t.env.DB.prepare("SELECT count FROM usage_daily WHERE service = 'tts'").first<{ count: number }>())?.count ?? 0;

beforeAll(async () => {
  t = await createTestEnv(testApp({ makeTts: () => tts.client }));
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["examples", "words", "usage_daily", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const listed = await t.env.MEDIA.list();
  await Promise.all(listed.objects.map((o) => t.env.MEDIA.delete(o.key)));
  tts.calls.length = 0;
  tts.state.fail = false;
  adultId = ((await t.api("POST", "/profiles", adult)).body as { id: string }).id;
});

describe("audio on save", () => {
  it("generates audio for the word and each example, stored in R2", async () => {
    const created = await createWord();
    expect(created.audio).toEqual({ missing: 0 });
    expect(tts.calls.map((c) => c.text).sort()).toEqual(["저는 학생이에요.", "학생", "학생이 많아요."].sort());
    expect(tts.calls.every((c) => c.voice === "ko-KR-SunHiNeural")).toBe(true);

    const d = await detail(created.id);
    expect(d.audio_key).toMatch(/^audio\/ko\/ko-KR-SunHiNeural\/[0-9a-f]{40}\.mp3$/);
    expect(d.examples.every((ex) => ex.audio_key)).toBe(true);
    expect(await t.env.MEDIA.head(d.audio_key!)).not.toBeNull();
    expect(await ttsUsage()).toBe(3);
  });

  it("reuses existing files: the same sentence in another word costs no Azure call", async () => {
    await createWord();
    tts.calls.length = 0;
    await createWord({ term: "학교", examples: [example("학생이 많아요.")] });
    expect(tts.calls.map((c) => c.text)).toEqual(["학교"]);
    expect(await ttsUsage()).toBe(4);
  });

  it("still saves the word when TTS fails, then 'Generate audio' fills the gaps", async () => {
    tts.state.fail = true;
    const created = await createWord();
    expect(created.audio).toEqual({ missing: 3 });
    expect((await detail(created.id)).audio_key).toBeNull();

    tts.state.fail = false;
    tts.calls.length = 0;
    const regen = await t.api("POST", `/words/${created.id}/audio`, { profile_id: adultId });
    expect(regen.body).toEqual({ missing: 0 });
    expect(tts.calls).toHaveLength(3);

    // Nothing left to do: no further Azure calls.
    tts.calls.length = 0;
    expect((await t.api("POST", `/words/${created.id}/audio`, { profile_id: adultId })).body).toEqual({ missing: 0 });
    expect(tts.calls).toHaveLength(0);
  });

  it("respects the daily TTS quota (the word is still saved)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await t.env.DB.prepare("INSERT INTO usage_daily (date, profile_id, service, count) VALUES (?, ?, 'tts', ?)")
      .bind(today, adultId, TTS_DAILY_QUOTA - 1)
      .run();
    const created = await createWord();
    expect(created.audio).toEqual({ missing: 2 });
    expect(tts.calls).toHaveLength(1);
  });

  it("generate-audio forbids kids and unknown words", async () => {
    const kid = await t.api("POST", "/profiles", { ...adult, name: "Bé", is_kid: true });
    const created = await createWord();
    expect((await t.api("POST", `/words/${created.id}/audio`, { profile_id: (kid.body as { id: string }).id })).status).toBe(403);
    expect((await t.api("POST", "/words/nope/audio", { profile_id: adultId })).status).toBe(404);
  });
});

describe("GET /api/media/audio/...", () => {
  it("serves the file with immutable cache headers", async () => {
    const d = await detail((await createWord({ examples: [] })).id);
    const res = await t.raw(`/api/media/${d.audio_key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("mp3:ko-KR-SunHiNeural:학생");
  });

  it("returns 404 for unknown or malformed keys", async () => {
    expect((await t.raw(`/api/media/audio/ko/ko-KR-SunHiNeural/${"0".repeat(40)}.mp3`)).status).toBe(404);
    expect((await t.raw("/api/media/audio/../secret")).status).toBe(404);
  });
});
