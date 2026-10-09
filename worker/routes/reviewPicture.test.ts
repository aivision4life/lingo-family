import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PhraseInput } from "../../shared/phrase";
import type { ProfileCreate } from "../../shared/profile";
import { queueResponseSchema, summarySchema } from "../../shared/review";
import type { WordCreate } from "../../shared/word";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;
const TZ = 540;

const profile = (over: Partial<ProfileCreate> = {}): ProfileCreate => ({
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 1, study_langs: ["ko"], ...over,
});
const phrase = (text: string): PhraseInput => ({
  text, reading: text, gloss_vi: `vi ${text}`, gloss_en: `en ${text}`, gloss_ko: `ko ${text}`, ai_generated: false, example: null,
});
const word = (profileId: string, term: string, phrases: PhraseInput[] = []): WordCreate => ({
  profile_id: profileId, lang: "ko", term, reading: term, pos: "noun",
  gloss_vi: `vi ${term}`, gloss_en: `en ${term}`, gloss_ko: `ko ${term}`,
  hanja: null, han_viet: null, emoji: null, ai_generated: false, phrases,
  examples: [
    { sentence: `${term} 예문`, translation_vi: "ví dụ", translation_en: "example", translation_ko: "", level: "beginner", ai_generated: false, image_prompt: null },
  ],
});

const createProfile = async (over: Partial<ProfileCreate> = {}) =>
  ((await t.api("POST", "/profiles", profile(over))).body as { id: string }).id;
const queue = async (pid: string) =>
  queueResponseSchema.parse((await t.api("GET", `/review/queue?profile_id=${pid}&lang=ko&tz=${TZ}`)).body).items;
const summary = async (pid: string) => summarySchema.parse((await t.api("GET", `/review/summary?profile_id=${pid}&tz=${TZ}`)).body);
const answer = (pid: string, cardId: string) =>
  t.api("POST", "/review/answer", { profile_id: pid, card_id: cardId, rating: 4, duration_ms: 1 });
const label = (i: { word: { kind: string; term: string }; card: { card_type: string } }) =>
  `${i.word.kind}:${i.word.term}/${i.card.card_type}`;
const types = async (pid: string, table: "word" | "phrase") =>
  (
    await t.env.DB.prepare(
      `SELECT card_type FROM cards WHERE profile_id = ? AND phrase_id IS ${table === "word" ? "" : "NOT "}NULL ORDER BY card_type`,
    )
      .bind(pid)
      .all<{ card_type: string }>()
  ).results.map((r) => r.card_type);
const setReady = (table: "words" | "phrases") =>
  t.env.DB.prepare(`UPDATE ${table} SET image_status = 'ready', image_key = 'images/ai/test.webp'`).run();
/** Answers the first card of the given type in today's queue. */
const answerType = async (pid: string, type: string) => {
  const item = (await queue(pid)).find((i) => i.card.card_type === type);
  expect(item, `a ${type} card in the queue`).toBeDefined();
  expect((await answer(pid, item!.card.id)).status).toBe(200);
};

let bo: string;

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["review_logs", "cards", "profile_decks", "deck_words", "decks", "examples", "phrases", "words", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  bo = await createProfile();
  await t.api("POST", "/words", word(bo, "학생", [phrase("대학생")]));
});

describe("picture cards", () => {
  it("1. item with a ready image: recognition → picture → listening, not limited by daily_new_limit", async () => {
    await setReady("words");
    expect((await queue(bo)).map(label)).toEqual(["word:학생/recognition"]); // limit 1; phrase has no image
    expect(await types(bo, "word")).toEqual(["listening", "picture", "recognition"]);

    await answerType(bo, "recognition");
    const afterRecognition = (await queue(bo)).map(label);
    expect(afterRecognition).toContain("word:학생/picture");
    expect(afterRecognition).not.toContain("word:학생/listening"); // waits for picture
    expect(afterRecognition).not.toContain("phrase:대학생/recognition"); // limit 1 is used up

    await answerType(bo, "picture");
    expect((await queue(bo)).map(label)).toContain("word:학생/listening");
  });

  it("2. item without a ready image skips picture: recognition → listening", async () => {
    for (const status of ["none", "pending", "failed"]) {
      await t.env.DB.prepare("UPDATE words SET image_status = ?, image_key = NULL").bind(status).run();
      await t.env.DB.prepare("DELETE FROM cards").run();
      expect((await queue(bo)).map(label)).toEqual(["word:학생/recognition"]);
      expect(await types(bo, "word")).toEqual(["listening", "recognition"]);
      await answerType(bo, "recognition");
      expect((await queue(bo)).map(label)).toContain("word:학생/listening");
    }
  });

  it("3. image ready later: picture is added, the listening card keeps its progress", async () => {
    await answerType(bo, "recognition");
    await answerType(bo, "listening");
    const before = await t.env.DB.prepare("SELECT id, reps, state FROM cards WHERE card_type = 'listening' AND phrase_id IS NULL").first<{ id: string; reps: number; state: number }>();
    expect(before?.reps).toBe(1);

    await setReady("words");
    await queue(bo); // sync
    expect(await types(bo, "word")).toEqual(["listening", "picture", "recognition"]);
    const after = await t.env.DB.prepare("SELECT id, reps, state FROM cards WHERE card_type = 'listening' AND phrase_id IS NULL").first();
    expect(after).toEqual(before);
    expect((await queue(bo)).map(label)).toContain("word:학생/picture");
  });

  it("phrases get picture cards too (adults), and kids get word pictures but no phrase cards", async () => {
    await setReady("words");
    await setReady("phrases");
    await queue(bo);
    expect(await types(bo, "phrase")).toEqual(["listening", "picture", "recognition"]);

    const kid = await createProfile({ name: "Bé", is_kid: true });
    await queue(kid);
    expect(await types(kid, "word")).toEqual(["listening", "picture", "recognition"]);
    expect(await types(kid, "phrase")).toEqual([]);
  });

  it("summary counts due + new cards by type; queue items carry the example sentences", async () => {
    await setReady("words");
    await answerType(bo, "recognition");
    expect(await summary(bo)).toEqual([{ lang: "ko", due: 0, new: 1, by_type: { recognition: 0, picture: 1, listening: 0 } }]);

    const item = (await queue(bo)).find((i) => i.card.card_type === "picture")!;
    expect(item.examples.map((e) => e.sentence)).toEqual(["학생 예문"]);
    const phraseItem = (await queue(bo)).find((i) => i.word.kind === "phrase");
    expect(phraseItem?.examples ?? []).toEqual([]);
  });
});
