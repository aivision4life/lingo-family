import { State } from "ts-fsrs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProfileCreate } from "../../shared/profile";
import { answerResponseSchema, queueResponseSchema, summarySchema } from "../../shared/review";
import type { WordCreate } from "../../shared/word";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;
const TZ = 540; // Korea

const profile = (over: Partial<ProfileCreate> = {}): ProfileCreate => ({
  name: "Bố",
  avatar: "🐻",
  ui_lang: "vi",
  gloss_lang: "vi",
  is_kid: false,
  daily_new_limit: 2,
  study_langs: ["ko"],
  ...over,
});

const word = (profileId: string, term: string, lang: WordCreate["lang"] = "ko"): WordCreate => ({
  profile_id: profileId,
  lang,
  term,
  reading: term,
  pos: "noun",
  gloss_vi: `vi ${term}`,
  gloss_en: `en ${term}`,
  gloss_ko: `ko ${term}`,
  hanja: null,
  han_viet: null,
  emoji: null,
  ai_generated: false,
  examples: [],
});

const createProfile = async (over: Partial<ProfileCreate> = {}) =>
  ((await t.api("POST", "/profiles", profile(over))).body as { id: string }).id;
const summary = async (pid: string) => summarySchema.parse((await t.api("GET", `/review/summary?profile_id=${pid}&tz=${TZ}`)).body);
const queue = async (pid: string, lang = "ko") =>
  queueResponseSchema.parse((await t.api("GET", `/review/queue?profile_id=${pid}&lang=${lang}&tz=${TZ}`)).body).items;
const answer = async (pid: string, cardId: string, rating: 1 | 2 | 3 | 4) =>
  t.api("POST", "/review/answer", { profile_id: pid, card_id: cardId, rating, duration_ms: 1500 });
const cardCount = async (pid: string) =>
  (await t.env.DB.prepare("SELECT count(*) AS n FROM cards WHERE profile_id = ?").bind(pid).first<{ n: number }>())?.n;

let bo: string;

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["review_logs", "cards", "profile_decks", "deck_words", "decks", "examples", "words", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  bo = await createProfile();
  // Words saved before any review (like words from M1.2/M1.3): 3 Korean + 1 English.
  for (const term of ["학생", "학교", "선생님"]) await t.api("POST", "/words", word(bo, term));
  await t.api("POST", "/words", word(bo, "apple", "en"));
});

describe("cards and queue", () => {
  it("creates recognition + listening cards for studied languages only", async () => {
    expect(await summary(bo)).toEqual([{ lang: "ko", due: 0, new: 2 }]);
    expect(await cardCount(bo)).toBe(6); // 3 Korean words × 2 types, no English cards
  });

  it("queue = new recognition cards up to the daily limit; listening waits", async () => {
    const items = await queue(bo);
    expect(items.map((i) => [i.word.term, i.card.card_type])).toEqual([
      ["학생", "recognition"],
      ["학교", "recognition"],
    ]);
  });

  it("answering schedules the card, appends a log and unlocks the listening card", async () => {
    const [first] = await queue(bo);
    const res = await answer(bo, first!.card.id, 3);
    expect(res.status).toBe(200);
    const updated = answerResponseSchema.parse(res.body).card;
    expect(updated).toMatchObject({ state: State.Learning, reps: 1 });

    const log = await t.env.DB.prepare("SELECT * FROM review_logs WHERE card_id = ?").bind(first!.card.id).first();
    expect(log).toMatchObject({ rating: 3, state: State.New, duration_ms: 1500, profile_id: bo });

    const items = await queue(bo);
    const kinds = items.map((i) => `${i.word.term}/${i.card.card_type}`);
    // Learning card due in 10 min (learn-ahead), listening of 학생 unlocked, 1 new recognition left today.
    expect(kinds).toEqual(["학생/recognition", "학생/listening", "학교/recognition"]);
    expect(await summary(bo)).toEqual([{ lang: "ko", due: 1, new: 2 }]);
  });

  it("daily_new_limit applies per language", async () => {
    await t.api("PATCH", `/profiles/${bo}`, { study_langs: ["ko", "en"] });
    for (const item of await queue(bo)) await answer(bo, item.card.id, 4);
    expect((await queue(bo, "en")).map((i) => i.word.term)).toEqual(["apple"]);
  });

  it("removing a language hides its cards but keeps progress", async () => {
    const [first] = await queue(bo);
    await answer(bo, first!.card.id, 3);
    await t.api("PATCH", `/profiles/${bo}`, { study_langs: ["en"] });
    expect(await queue(bo, "ko")).toEqual([]);
    expect(await cardCount(bo)).toBe(8); // ko cards kept + new en cards

    await t.api("PATCH", `/profiles/${bo}`, { study_langs: ["ko"] });
    expect((await queue(bo))[0]!.card).toMatchObject({ id: first!.card.id, reps: 1 });
  });

  it("profiles have separate queues and cannot answer each other's cards", async () => {
    const me = await createProfile({ name: "Mẹ" });
    const [boCard] = await queue(bo);
    await answer(bo, boCard!.card.id, 4);
    expect((await queue(me)).every((i) => i.card.reps === 0)).toBe(true);
    expect((await answer(me, boCard!.card.id, 3)).status).toBe(404);
  });

  it("rejects invalid ratings and ignores X-Dev-Now when the flag is off", async () => {
    const [first] = await queue(bo);
    expect((await t.api("POST", "/review/answer", { profile_id: bo, card_id: first!.card.id, rating: 5, duration_ms: 1 })).status).toBe(400);
    const res = await t.raw(`/api/review/queue?profile_id=${bo}&lang=ko&tz=${TZ}`, { "X-Dev-Now": "2030-01-01T00:00:00Z" });
    const body = queueResponseSchema.parse(await res.json());
    expect(new Date(body.now).getFullYear()).not.toBe(2030);
  });
});

describe("dev time travel", () => {
  it("with DEV_TIME_TRAVEL=1 the fake date makes cards due", async () => {
    const dev = await createTestEnv(undefined, { DEV_TIME_TRAVEL: "1" });
    try {
      const pid = ((await dev.api("POST", "/profiles", profile({ daily_new_limit: 1 }))).body as { id: string }).id;
      await dev.api("POST", "/words", word(pid, "학생"));
      const items = queueResponseSchema.parse((await dev.api("GET", `/review/queue?profile_id=${pid}&lang=ko&tz=${TZ}`)).body).items;
      await dev.api("POST", "/review/answer", { profile_id: pid, card_id: items[0]!.card.id, rating: 4, duration_ms: null });

      const later = await dev.raw(`/api/review/queue?profile_id=${pid}&lang=ko&tz=${TZ}`, { "X-Dev-Now": "2030-01-01T00:00:00Z" });
      const body = queueResponseSchema.parse(await later.json());
      expect(new Date(body.now).toISOString()).toBe("2030-01-01T00:00:00.000Z");
      expect(body.items.find((i) => i.card.id === items[0]!.card.id)?.card.state).toBe(State.Review);
    } finally {
      await dev.dispose();
    }
  }, 60_000);
});
