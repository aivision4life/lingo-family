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
const setCardTypes = (pid: string, card_types: string[]) => t.api("PATCH", `/profiles/${pid}`, { card_types });
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
    expect(await types(bo, "word")).toEqual(["listening", "picture", "recognition", "speaking"]);

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
      expect(await types(bo, "word")).toEqual(["listening", "recognition", "speaking"]);
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
    expect(await types(bo, "word")).toEqual(["listening", "picture", "recognition", "speaking"]);
    const after = await t.env.DB.prepare("SELECT id, reps, state FROM cards WHERE card_type = 'listening' AND phrase_id IS NULL").first();
    expect(after).toEqual(before);
    expect((await queue(bo)).map(label)).toContain("word:학생/picture");
  });

  it("phrases get picture cards too (adults), and kids get word pictures but no phrase cards", async () => {
    await setReady("words");
    await setReady("phrases");
    await queue(bo);
    expect(await types(bo, "phrase")).toEqual(["listening", "picture", "recognition", "speaking"]);

    const kid = await createProfile({ name: "Bé", is_kid: true });
    await queue(kid);
    expect(await types(kid, "word")).toEqual(["listening", "picture", "recognition", "speaking"]);
    expect(await types(kid, "phrase")).toEqual([]);
  });

  it("summary counts due + new cards by type; queue items carry the example sentences", async () => {
    await setReady("words");
    await answerType(bo, "recognition");
    expect(await summary(bo)).toEqual([{ lang: "ko", due: 0, new: 1, by_type: { recognition: 0, picture: 1, listening: 0, speaking: 0 }, albums: [] }]);

    const item = (await queue(bo)).find((i) => i.card.card_type === "picture")!;
    expect(item.examples.map((e) => e.sentence)).toEqual(["학생 예문"]);
    const phraseItem = (await queue(bo)).find((i) => i.word.kind === "phrase");
    expect(phraseItem?.examples ?? []).toEqual([]);
  });
});

// M6.6: a profile can switch a review card type off. The cards, their FSRS schedule and their
// review history must survive untouched — only the queue stops offering them.
describe("card type setting", () => {
  it("hides a disabled type from the queue and from the summary, without deleting its cards", async () => {
    await setReady("words");
    await setCardTypes(bo, ["recognition", "listening"]);
    await answerType(bo, "recognition");

    const labels = (await queue(bo)).map(label);
    expect(labels).toContain("word:학생/listening"); // gated on recognition now that picture is off
    expect(labels).not.toContain("word:학생/picture");
    // The picture card itself still exists and keeps its row.
    expect(await types(bo, "word")).toEqual(["listening", "picture", "recognition", "speaking"]);

    const [{ by_type }] = await summary(bo);
    expect(by_type.picture).toBe(0);
  });

  it("re-enabling a type brings its cards back on their old schedule, not as new", async () => {
    await setReady("words");
    await answerType(bo, "recognition");
    // Rated "Again", so the picture card stays in learning and due within the learn-ahead window:
    // if re-enabling reset it, it would come back as a New card instead of this exact row.
    const picture = (await queue(bo)).find((i) => i.card.card_type === "picture")!;
    await t.api("POST", "/review/answer", { profile_id: bo, card_id: picture.card.id, rating: 1, duration_ms: 1 });
    const before = await t.env.DB.prepare(
      "SELECT id, reps, state, due FROM cards WHERE card_type = 'picture' AND phrase_id IS NULL",
    ).first();
    expect((before as { reps: number }).reps).toBe(1);

    await setCardTypes(bo, ["recognition", "listening"]);
    expect((await queue(bo)).map(label)).not.toContain("word:학생/picture");

    await setCardTypes(bo, ["recognition", "picture", "listening"]);
    const after = await t.env.DB.prepare(
      "SELECT id, reps, state, due FROM cards WHERE card_type = 'picture' AND phrase_id IS NULL",
    ).first();
    expect(after).toEqual(before);
    expect((await queue(bo)).map(label)).toContain("word:학생/picture");
  });

  it("with recognition off, picture becomes the entry type and obeys daily_new_limit", async () => {
    await setReady("words");
    await setReady("phrases");
    await queue(bo); // sync so the phrase gets its picture card too
    await setCardTypes(bo, ["picture", "listening"]);

    // daily_new_limit is 1 in this file, so only the oldest item's picture card is introduced.
    const labels = (await queue(bo)).map(label);
    expect(labels).toEqual(["word:학생/picture"]);
  });

  it("rejects an empty list (an empty review session would look like a bug, not a setting)", async () => {
    const res = await t.api("PATCH", `/profiles/${bo}`, { card_types: [] });
    expect(res.status).toBe(400);
  });
});

// M6.12: "only review words I added". Like the card-type setting, it only hides cards — the rows,
// their FSRS schedule and their history must survive, so turning it off resumes them.
describe("own words only", () => {
  const setOwnWordsOnly = (pid: string, own_words_only: boolean) => t.api("PATCH", `/profiles/${pid}`, { own_words_only });

  it("keeps only the profile's own words in the queue, and the summary agrees with it", async () => {
    // `bo` already owns 학생 (+ its phrase 대학생) from beforeEach; me owns another word.
    const me = await createProfile({ name: "Mẹ", daily_new_limit: 10 });
    await t.api("POST", "/words", word(me, "사과"));
    await setOwnWordsOnly(me, true);

    const labels = (await queue(me)).map(label);
    expect(labels).toContain("word:사과/recognition");
    expect(labels.some((l) => l.includes("학생"))).toBe(false);

    // Home's counts come from the same filtered inputs, so they match the queue exactly.
    const [{ due, new: fresh }] = await summary(me);
    expect(due + fresh).toBe(labels.length);
  });

  it("hides a phrase whose own creator is someone else, even when its root word is mine", async () => {
    const me = await createProfile({ name: "Mẹ", daily_new_limit: 10 });
    await t.api("POST", "/words", word(me, "사과", [phrase("사과 주스")]));
    await t.env.DB.prepare("UPDATE phrases SET created_by_profile = ? WHERE text = ?").bind(bo, "사과 주스").run();
    await setOwnWordsOnly(me, true);

    const labels = (await queue(me)).map(label);
    expect(labels).toContain("word:사과/recognition");
    expect(labels).not.toContain("phrase:사과 주스/recognition");
  });

  it("turning it off again brings the hidden cards back on their old schedule, not as new", async () => {
    const me = await createProfile({ name: "Mẹ", daily_new_limit: 10 });
    await t.api("POST", "/words", word(me, "사과"));
    // Study someone else's word first, then hide it.
    await t.env.DB.prepare("UPDATE words SET created_by_profile = ? WHERE term = ?").bind(bo, "학생").run();
    const theirs = (await queue(me)).find((i) => i.word.term === "학생")!;
    await t.api("POST", "/review/answer", { profile_id: me, card_id: theirs.card.id, rating: 1, duration_ms: 1 });
    const before = await t.env.DB.prepare("SELECT id, reps, state, due FROM cards WHERE id = ?").bind(theirs.card.id).first();
    expect((before as { reps: number }).reps).toBe(1);

    await setOwnWordsOnly(me, true);
    expect((await queue(me)).some((i) => i.word.term === "학생")).toBe(false);
    // Hidden, not deleted: the row is still there, untouched, while it is out of the queue.
    expect(await t.env.DB.prepare("SELECT id, reps, state, due FROM cards WHERE id = ?").bind(theirs.card.id).first()).toEqual(before);

    await setOwnWordsOnly(me, false);
    expect(await t.env.DB.prepare("SELECT id, reps, state, due FROM cards WHERE id = ?").bind(theirs.card.id).first()).toEqual(before);
    expect((await queue(me)).some((i) => i.word.term === "학생")).toBe(true);
  });

  it("is off by default, so an existing profile sees everything as before", async () => {
    const me = await createProfile({ name: "Mẹ", daily_new_limit: 10 });
    expect((await queue(me)).some((i) => i.word.term === "학생")).toBe(true);
  });
});
