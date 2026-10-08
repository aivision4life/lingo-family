import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { phraseListSchema, type PhraseInput } from "../../shared/phrase";
import type { ProfileCreate } from "../../shared/profile";
import { wordCreatedSchema, wordDetailSchema, wordListSchema, type WordCreate } from "../../shared/word";
import { fakeLlm, sampleEnrichment } from "../test/fakeLlm";
import { fakeTts } from "../test/fakeTts";
import { createTestEnv, testApp } from "../test/testEnv";

const llm = fakeLlm([JSON.stringify({ phrases: sampleEnrichment.phrases })]);
const tts = fakeTts();
let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult: string;
let kid: string;

const profile = (over: Partial<ProfileCreate> = {}): ProfileCreate => ({
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 10, study_langs: ["ko"], ...over,
});

const phrase = (text: string, withExample = true): PhraseInput => ({
  text,
  reading: "r",
  gloss_vi: `vi ${text}`,
  gloss_en: `en ${text}`,
  gloss_ko: `ko ${text}`,
  ai_generated: true,
  example: withExample
    ? { sentence: `${text} 문장.`, translation_vi: "câu", translation_en: "sentence", translation_ko: "", level: "beginner", ai_generated: true }
    : null,
});

const word = (term: string, phrases: PhraseInput[] = []): WordCreate => ({
  profile_id: adult, lang: "ko", term, reading: term, pos: "noun",
  gloss_vi: `vi ${term}`, gloss_en: `en ${term}`, gloss_ko: `ko ${term}`,
  hanja: null, han_viet: null, emoji: null, ai_generated: false,
  examples: [{ sentence: `${term}이에요.`, translation_vi: "x", translation_en: "x", translation_ko: "", level: "beginner", ai_generated: false }],
  phrases,
});

const createWord = async (term: string, phrases: PhraseInput[] = []) => {
  const res = await t.api("POST", "/words", word(term, phrases));
  if (res.status !== 201) throw new Error(`POST /words ${term}: ${res.status} ${JSON.stringify(res.body)}`);
  return wordCreatedSchema.parse(res.body);
};
const detail = async (id: string) => wordDetailSchema.parse((await t.api("GET", `/words/${id}`)).body);
const one = async (sql: string) => (await t.env.DB.prepare(sql).first<{ n: number }>())?.n;

beforeAll(async () => {
  t = await createTestEnv(testApp({ makeLlm: () => llm.client, makeTts: () => tts.client }));
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["review_logs", "cards", "examples", "phrases", "words", "ai_cache", "usage_daily", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  llm.requests.length = 0;
  tts.calls.length = 0;
  adult = ((await t.api("POST", "/profiles", profile())).body as { id: string }).id;
  kid = ((await t.api("POST", "/profiles", profile({ name: "Bé", is_kid: true }))).body as { id: string }).id;
});

describe("phrases saved with a new word", () => {
  it("saves ticked phrases with their example (root word kept in word_id) and generates audio", async () => {
    const created = await createWord("학생", [phrase("대학생"), phrase("학생증", false)]);
    expect(created.skipped_phrases).toEqual([]);
    expect(created.audio.missing).toBe(0);

    const d = await detail(created.id);
    expect(d.phrases.map((p) => p.text)).toEqual(["대학생", "학생증"]);
    expect(d.phrases[0]!.examples).toHaveLength(1);
    expect(d.phrases[1]!.examples).toHaveLength(0);
    expect(d.examples).toHaveLength(1); // the word's own example only
    expect(d.phrases.every((p) => p.audio_key)).toBe(true);
    expect(d.phrases[0]!.examples[0]!.audio_key).toBeTruthy();
    expect(tts.calls.map((c) => c.text)).toEqual(expect.arrayContaining(["대학생", "학생증", "대학생 문장."]));

    const list = wordListSchema.parse((await t.api("GET", "/words")).body);
    expect(list[0]).toMatchObject({ term: "학생", phrase_count: 2 });
  });

  it("skips duplicates: same text twice, the root word itself, or a phrase under another word", async () => {
    await createWord("대학", [phrase("대학생")]);
    const created = await createWord("학생", [phrase("대학생"), phrase("학생"), phrase("학생회")]);
    expect(created.skipped_phrases).toEqual([
      { text: "대학생", existing_word_term: "대학" },
      { text: "학생", existing_word_term: "학생" },
    ]);
    // The same text twice in one request: the second one is skipped.
    const again = await t.api("POST", `/words/${created.id}/phrases`, { profile_id: adult, phrases: [phrase("학생증"), phrase("학생증")] });
    expect((again.body as { skipped: unknown[] }).skipped).toEqual([{ text: "학생증", existing_word_term: "학생" }]);
    expect((await detail(created.id)).phrases.map((p) => p.text)).toEqual(["학생회", "학생증"]);
  });
});

describe("phrases of an existing word", () => {
  it("suggests phrases with the LLM (cache-first, one quota unit) and saves the chosen ones", async () => {
    const { id } = await createWord("학생");
    const first = await t.api("POST", `/words/${id}/phrases/suggest`, { profile_id: adult, level: "beginner" });
    expect(first.body).toMatchObject({ cached: false, phrases: [{ text: "대학생" }, { text: "학생증" }] });
    const second = await t.api("POST", `/words/${id}/phrases/suggest`, { profile_id: adult, level: "beginner" });
    expect(second.body).toMatchObject({ cached: true });
    expect(llm.requests).toHaveLength(1);
    expect(await one("SELECT count AS n FROM usage_daily WHERE service = 'llm'")).toBe(1);

    const saved = await t.api("POST", `/words/${id}/phrases`, { profile_id: adult, phrases: [phrase("대학생")] });
    expect(saved.status).toBe(201);
    expect((saved.body as { saved: string[] }).saved).toHaveLength(1);
  });

  it("kid profiles cannot suggest, save, edit or delete", async () => {
    const { id } = await createWord("학생", [phrase("대학생")]);
    const pid = (await detail(id)).phrases[0]!.id;
    expect((await t.api("POST", `/words/${id}/phrases/suggest`, { profile_id: kid, level: "kid" })).status).toBe(403);
    expect((await t.api("POST", `/words/${id}/phrases`, { profile_id: kid, phrases: [phrase("학생증")] })).status).toBe(403);
    expect((await t.api("PATCH", `/phrases/${pid}`, { profile_id: kid, gloss_vi: "x" })).status).toBe(403);
    expect((await t.api("DELETE", `/phrases/${pid}`, { profile_id: kid })).status).toBe(403);
    expect((await t.api("DELETE", `/words/${id}`, { profile_id: kid })).status).toBe(403);
  });

  it("lists phrases with their root word and filters by text", async () => {
    await createWord("학생", [phrase("대학생")]);
    await createWord("학교", [phrase("학교생활")]);
    const all = phraseListSchema.parse((await t.api("GET", "/phrases")).body);
    expect(all.map((p) => [p.text, p.root_term]).sort()).toEqual([["대학생", "학생"], ["학교생활", "학교"]]);
    expect(phraseListSchema.parse((await t.api("GET", "/phrases?q=대학")).body).map((p) => p.text)).toEqual(["대학생"]);
  });
});

describe("editing and deleting", () => {
  it("edits a phrase: new text gets new audio, duplicates are refused, the example is replaced", async () => {
    const { id } = await createWord("학생", [phrase("대학생"), phrase("학생증")]);
    const [a, b] = (await detail(id)).phrases;
    const oldAudio = a!.audio_key;

    const dup = await t.api("PATCH", `/phrases/${a!.id}`, { profile_id: adult, text: "학생증" });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: "duplicate_phrase", existing_word_term: "학생" });

    const ok = await t.api("PATCH", `/phrases/${a!.id}`, {
      profile_id: adult,
      text: "고등학생",
      example: { sentence: "고등학생이에요.", translation_vi: "y", translation_en: "y", translation_ko: "", level: "beginner", ai_generated: false },
    });
    expect(ok.status).toBe(200);
    const edited = (await detail(id)).phrases.find((p) => p.id === a!.id)!;
    expect(edited).toMatchObject({ text: "고등학생" });
    expect(edited.audio_key).not.toBe(oldAudio);
    expect(edited.examples.map((e) => e.sentence)).toEqual(["고등학생이에요."]);

    await t.api("PATCH", `/phrases/${b!.id}`, { profile_id: adult, example: null });
    expect((await detail(id)).phrases.find((p) => p.id === b!.id)!.examples).toEqual([]);
  });

  it("deleting a phrase or a word removes cards but keeps review logs (card_id → NULL)", async () => {
    const { id } = await createWord("학생", [phrase("대학생")]);
    const queue = (await t.api("GET", `/review/queue?profile_id=${adult}&lang=ko&tz=540`)).body as {
      items: { card: { id: string }; word: { kind: string } }[];
    };
    for (const item of queue.items) await t.api("POST", "/review/answer", { profile_id: adult, card_id: item.card.id, rating: 3, duration_ms: 1 });
    expect(await one("SELECT count(*) AS n FROM review_logs")).toBe(2); // word + phrase recognition

    const pid = (await detail(id)).phrases[0]!.id;
    expect((await t.api("DELETE", `/phrases/${pid}`, { profile_id: adult })).status).toBe(204);
    expect(await one("SELECT count(*) AS n FROM cards WHERE phrase_id IS NOT NULL")).toBe(0);
    // Cards are created lazily per profile: only the adult (who opened the queue) has word cards.
    expect((await detail(id)).card_count).toBe(2);

    expect((await t.api("DELETE", `/words/${id}`, { profile_id: adult })).status).toBe(204);
    expect(await one("SELECT count(*) AS n FROM cards")).toBe(0);
    expect(await one("SELECT count(*) AS n FROM review_logs WHERE card_id IS NULL AND lang = 'ko'")).toBe(2);
    expect((await t.api("GET", `/words/${id}`)).status).toBe(404);
  });
});
