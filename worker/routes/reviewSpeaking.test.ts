// M3.3 — speaking cards: who may turn them on, when they are offered, and who decides the rating.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PRON_DAILY_QUOTA_ADULT, PRON_DAILY_QUOTA_KID, PRON_FAMILY_DAILY_CAP } from "../../shared/pron";
import { profileSchema, type ProfileCreate } from "../../shared/profile";
import { answerResponseSchema, queueResponseSchema, summarySchema } from "../../shared/review";
import type { WordCreate } from "../../shared/word";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;
const TZ = 540;
const today = () => new Date().toISOString().slice(0, 10);

const profile = (over: Partial<ProfileCreate> = {}): ProfileCreate => ({
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 5, study_langs: ["ko"], ...over,
});
const word = (profileId: string, term: string): WordCreate => ({
  profile_id: profileId, lang: "ko", term, reading: term, pos: "noun",
  gloss_vi: `vi ${term}`, gloss_en: `en ${term}`, gloss_ko: `ko ${term}`,
  hanja: null, han_viet: null, emoji: null, ai_generated: false, phrases: [], examples: [],
});

const createProfile = async (over: Partial<ProfileCreate> = {}) => {
  const res = await t.api("POST", "/profiles", profile(over));
  expect(res.status).toBe(201);
  return profileSchema.parse(res.body);
};
const queue = async (pid: string) =>
  queueResponseSchema.parse((await t.api("GET", `/review/queue?profile_id=${pid}&lang=ko&tz=${TZ}`)).body);
const summary = async (pid: string) => summarySchema.parse((await t.api("GET", `/review/summary?profile_id=${pid}&tz=${TZ}`)).body);
const label = (i: { word: { term: string }; card: { card_type: string } }) => `${i.word.term}/${i.card.card_type}`;

/** Answers every card of one type that is in the queue, so the next type unlocks. */
const answerType = async (pid: string, type: string) => {
  for (const item of (await queue(pid)).items.filter((i) => i.card.card_type === type)) {
    const res = await t.api("POST", "/review/answer", { profile_id: pid, card_id: item.card.id, rating: 3, duration_ms: 1 });
    expect(res.status).toBe(200);
  }
};

/** The speaking card of a word, once the types before it in the chain have been answered. */
const speakingCard = async (pid: string, term?: string) => {
  await answerType(pid, "recognition");
  await answerType(pid, "listening");
  // Every profile studies the whole deck, so a term is needed once there is more than one word.
  const card = (await queue(pid)).items.find((i) => i.card.card_type === "speaking" && (!term || i.word.term === term));
  expect(card, "a speaking card should be unlocked by now").toBeDefined();
  return card!;
};

/** A `pron_attempts` row exactly as the Worker writes one, with the score and age a test needs. */
const attempt = async (
  id: string,
  over: { profile_id: string; word_id?: string | null; phrase_id?: string | null; score: number; ageMs?: number },
) => {
  await t.env.DB.prepare(
    `INSERT INTO pron_attempts (id, profile_id, word_id, phrase_id, lang, reference_text, pron_score, accuracy, fluency, completeness, created_at)
     VALUES (?1, ?2, ?3, ?4, 'ko', 'x', ?5, ?5, ?5, ?5, ?6)`,
  )
    .bind(id, over.profile_id, over.word_id ?? null, over.phrase_id ?? null, over.score, Date.now() - (over.ageMs ?? 0))
    .run();
  return id;
};

const spend = (profileId: string, count: number) =>
  t.env.DB.prepare(
    `INSERT INTO usage_daily (date, profile_id, service, count) VALUES (?1, ?2, 'pron', ?3)
     ON CONFLICT (date, profile_id, service) DO UPDATE SET count = count + ?3`,
  )
    .bind(today(), profileId, count)
    .run();

const cardRow = (id: string) =>
  t.env.DB.prepare("SELECT reps, state, due, last_review FROM cards WHERE id = ?").bind(id).first<{ reps: number }>();
const logCount = async (cardId: string) =>
  (await t.env.DB.prepare("SELECT count(*) AS n FROM review_logs WHERE card_id = ?").bind(cardId).first<{ n: number }>())!.n;

beforeAll(async () => {
  t = await createTestEnv();
}, 120_000);
afterAll(async () => await t.dispose());
beforeEach(async () => {
  for (const table of ["review_logs", "pron_attempts", "cards", "usage_daily", "examples", "words", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe("speaking is off until a profile asks for it", () => {
  it("is not in a new profile's card types, and no speaking card is offered", async () => {
    const bo = await createProfile();
    expect(bo.card_types).toEqual(["recognition", "picture", "listening"]);
    await t.api("POST", "/words", word(bo.id, "학생"));

    await answerType(bo.id, "recognition");
    await answerType(bo.id, "listening");
    expect((await queue(bo.id)).items.map(label)).not.toContain("학생/speaking");
    // The card exists all the same, so switching the type on later resumes it (M6.6).
    const row = await t.env.DB.prepare("SELECT count(*) AS n FROM cards WHERE card_type = 'speaking'").first<{ n: number }>();
    expect(row!.n).toBe(1);
  });

  it("comes last in the unlock chain: after listening, never before", async () => {
    const bo = await createProfile({ card_types: ["recognition", "picture", "listening", "speaking"] });
    await t.api("POST", "/words", word(bo.id, "학생"));

    expect((await queue(bo.id)).items.map(label)).toEqual(["학생/recognition"]);
    await answerType(bo.id, "recognition");
    expect((await queue(bo.id)).items.map(label)).not.toContain("학생/speaking");
    await answerType(bo.id, "listening");
    expect((await queue(bo.id)).items.map(label)).toContain("학생/speaking");
  });

  it("with listening off, speaking waits for the nearest enabled type instead", async () => {
    const bo = await createProfile({ card_types: ["recognition", "speaking"] });
    await t.api("POST", "/words", word(bo.id, "학생"));
    await answerType(bo.id, "recognition");
    expect((await queue(bo.id)).items.map(label)).toContain("학생/speaking");
  });
});

describe("the server rates a speaking card from the scores it stored itself", () => {
  let bo: Awaited<ReturnType<typeof createProfile>>;
  let wordId: string;
  let cardId: string;

  beforeEach(async () => {
    bo = await createProfile({ card_types: ["recognition", "picture", "listening", "speaking"] });
    const res = await t.api("POST", "/words", word(bo.id, "학생"));
    wordId = (res.body as { id: string }).id;
    cardId = (await speakingCard(bo.id)).card.id;
  });

  const rate = (body: Record<string, unknown>) =>
    t.api("POST", "/review/answer", { profile_id: bo.id, card_id: cardId, duration_ms: 1, ...body });

  it("takes the best take, not the last one, and says which rating it applied", async () => {
    await attempt("a1", { profile_id: bo.id, word_id: wordId, score: 40 });
    await attempt("a2", { profile_id: bo.id, word_id: wordId, score: 92 });
    await attempt("a3", { profile_id: bo.id, word_id: wordId, score: 70 });

    const res = await rate({ attempt_ids: ["a1", "a2", "a3"] });
    expect(res.status).toBe(200);
    expect(answerResponseSchema.parse(res.body)).toMatchObject({ counted: true, rating: 4 }); // 92 → Easy
    expect(await logCount(cardId)).toBe(1);
  });

  it("each band comes out of the stored score, not out of anything the client sent", async () => {
    for (const [score, rating] of [[59, 1], [60, 2], [80, 3], [90, 4]] as const) {
      const fresh = await createProfile({ name: `P${score}`, card_types: ["recognition", "listening", "speaking"] });
      const w = (await t.api("POST", "/words", word(fresh.id, `학생${score}`))).body as { id: string };
      const sc = await speakingCard(fresh.id, `학생${score}`);
      await attempt(`s${score}`, { profile_id: fresh.id, word_id: w.id, score });
      const res = await t.api("POST", "/review/answer", {
        profile_id: fresh.id, card_id: sc.card.id, duration_ms: 1, attempt_ids: [`s${score}`],
      });
      expect(answerResponseSchema.parse(res.body).rating, `score ${score}`).toBe(rating);
    }
  });

  it("a rating chosen by hand wins, even when takes were sent with it", async () => {
    await attempt("a1", { profile_id: bo.id, word_id: wordId, score: 95 });
    expect(answerResponseSchema.parse((await rate({ rating: 1, attempt_ids: ["a1"] })).body)).toMatchObject({
      counted: true,
      rating: 1,
    });
  });

  it("no take that could be scored = the card is not reviewed at all: no log, same schedule", async () => {
    const before = await cardRow(cardId);
    expect(answerResponseSchema.parse((await rate({ attempt_ids: ["nothing-was-scored"] })).body)).toMatchObject({
      counted: false,
      rating: null,
    });
    expect(await cardRow(cardId)).toEqual(before);
    expect(await logCount(cardId)).toBe(0);
  });

  it("refuses a take of another profile, of another item, or from before this card's last review", async () => {
    const other = await createProfile({ name: "Mẹ" });
    const otherWord = (await t.api("POST", "/words", word(bo.id, "학교"))).body as { id: string };
    await attempt("foreign", { profile_id: other.id, word_id: wordId, score: 99 });
    await attempt("otherItem", { profile_id: bo.id, word_id: otherWord.id, score: 99 });
    await attempt("stale", { profile_id: bo.id, word_id: wordId, score: 99, ageMs: 3 * 60 * 60 * 1000 });

    expect(answerResponseSchema.parse((await rate({ attempt_ids: ["foreign", "otherItem", "stale"] })).body)).toMatchObject({
      counted: false,
      rating: null,
    });
    expect(await logCount(cardId)).toBe(0);
  });

  it("refuses a request with neither a rating nor a take", async () => {
    expect((await rate({})).status).toBe(400);
  });
});

describe("running out of scoring for today", () => {
  it("drops speaking from the queue and the Home counts, and says why — it never rates anything", async () => {
    const bo = await createProfile({ card_types: ["recognition", "picture", "listening", "speaking"] });
    await t.api("POST", "/words", word(bo.id, "학생"));
    await answerType(bo.id, "recognition");
    await answerType(bo.id, "listening");
    expect((await queue(bo.id)).items.map(label)).toContain("학생/speaking");

    await spend(bo.id, PRON_DAILY_QUOTA_ADULT);
    const q = await queue(bo.id);
    expect(q.items.map(label)).not.toContain("학생/speaking");
    expect(q.speaking_blocked).toBe("quota");
    expect((await summary(bo.id))[0]!.by_type.speaking).toBe(0);
    // The card keeps its schedule: nothing was reviewed and nothing was logged.
    const row = await t.env.DB.prepare("SELECT reps FROM cards WHERE card_type = 'speaking'").first<{ reps: number }>();
    expect(row!.reps).toBe(0);
  });

  it("the family cap blocks it too, with the profile's own tier untouched", async () => {
    const bo = await createProfile({ card_types: ["recognition", "listening", "speaking"] });
    const other = await createProfile({ name: "Mẹ" });
    await t.api("POST", "/words", word(bo.id, "학생"));
    await speakingCard(bo.id);
    await spend(other.id, PRON_FAMILY_DAILY_CAP);
    expect((await queue(bo.id)).speaking_blocked).toBe("quota");
  });

  it("a kid profile practises speaking on the smaller tier", async () => {
    const bo = await createProfile(); // a family always keeps one adult profile, and kids add no words
    const kid = await createProfile({ name: "Bé", is_kid: true, card_types: ["recognition", "listening", "speaking"] });
    const added = await t.api("POST", "/words", word(bo.id, "학생"));
    expect(added.status).toBe(201);
    const w = added.body as { id: string };
    const card = await speakingCard(kid.id);

    await spend(kid.id, PRON_DAILY_QUOTA_KID - 1);
    expect((await queue(kid.id)).speaking_blocked).toBeNull();

    await attempt("k1", { profile_id: kid.id, word_id: w.id, score: 85 });
    const res = await t.api("POST", "/review/answer", {
      profile_id: kid.id, card_id: card.card.id, duration_ms: 1, attempt_ids: ["k1"],
    });
    expect(answerResponseSchema.parse(res.body)).toMatchObject({ counted: true, rating: 3 });

    await spend(kid.id, 1); // the kid's 15 are gone while an adult would still have 10 left
    expect((await queue(kid.id)).speaking_blocked).toBe("quota");
  });
});
