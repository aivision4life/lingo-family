import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PhraseInput } from "../../shared/phrase";
import type { ProfileCreate } from "../../shared/profile";
import { queueResponseSchema } from "../../shared/review";
import type { WordCreate } from "../../shared/word";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;
const TZ = 540;

const profile = (over: Partial<ProfileCreate> = {}): ProfileCreate => ({
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 10, study_langs: ["ko"], ...over,
});

const phrase = (text: string): PhraseInput => ({
  text, reading: text, gloss_vi: `vi ${text}`, gloss_en: `en ${text}`, gloss_ko: `ko ${text}`, ai_generated: false, example: null,
});

const word = (profileId: string, term: string, phrases: PhraseInput[] = []): WordCreate => ({
  profile_id: profileId, lang: "ko", term, reading: term, pos: "noun",
  gloss_vi: `vi ${term}`, gloss_en: `en ${term}`, gloss_ko: `ko ${term}`,
  hanja: null, han_viet: null, emoji: null, ai_generated: false, examples: [], phrases,
});

const createProfile = async (over: Partial<ProfileCreate> = {}) =>
  ((await t.api("POST", "/profiles", profile(over))).body as { id: string }).id;
const queue = async (pid: string) =>
  queueResponseSchema.parse((await t.api("GET", `/review/queue?profile_id=${pid}&lang=ko&tz=${TZ}`)).body).items;
const answer = (pid: string, cardId: string) =>
  t.api("POST", "/review/answer", { profile_id: pid, card_id: cardId, rating: 4, duration_ms: 1 });
const label = (i: { word: { kind: string; term: string }; card: { card_type: string } }) =>
  `${i.word.kind}:${i.word.term}/${i.card.card_type}`;
const phraseCards = async (pid: string) =>
  (await t.env.DB.prepare("SELECT count(*) AS n FROM cards WHERE profile_id = ? AND phrase_id IS NOT NULL").bind(pid).first<{ n: number }>())?.n;

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

describe("phrase cards", () => {
  it("adults get recognition + listening + speaking phrase cards; the queue shows the root word", async () => {
    const items = await queue(bo);
    expect(items.map(label).sort()).toEqual(["phrase:대학생/recognition", "word:학생/recognition"]);
    expect(await phraseCards(bo)).toBe(3); // recognition + listening + speaking (M3.3)
    const p = items.find((i) => i.word.kind === "phrase")!;
    expect(p.word).toMatchObject({ root_term: "학생", gloss_vi: "vi 대학생" });
  });

  it("phrase listening unlocks after its recognition card is answered", async () => {
    const p = (await queue(bo)).find((i) => i.word.kind === "phrase")!;
    expect((await answer(bo, p.card.id)).status).toBe(200);
    expect((await queue(bo)).map(label)).toContain("phrase:대학생/listening");
    expect((await queue(bo)).map(label)).not.toContain("word:학생/listening");
  });

  it("new phrase recognition cards count toward daily_new_limit per language", async () => {
    const one = await createProfile({ name: "Mẹ", daily_new_limit: 1 });
    const [first, ...rest] = await queue(one);
    expect(rest).toEqual([]);
    await answer(one, first!.card.id);
    // The single new card for today is used: only the unlocked listening card of that item may follow.
    expect((await queue(one)).filter((i) => i.card.card_type === "recognition" && i.card.reps === 0)).toEqual([]);
  });

  it("kid profiles get no phrase cards and never see existing ones", async () => {
    const kid = await createProfile({ name: "Bé", is_kid: true });
    expect((await queue(kid)).map(label)).toEqual(["word:학생/recognition"]);
    expect(await phraseCards(kid)).toBe(0);

    // A phrase card left over (e.g. the profile became a kid later) stays hidden.
    const pid = (await t.env.DB.prepare("SELECT id FROM phrases").first<{ id: string }>())!.id;
    const wid = (await t.env.DB.prepare("SELECT id FROM words").first<{ id: string }>())!.id;
    await t.env.DB.prepare(
      `INSERT INTO cards (id, profile_id, word_id, phrase_id, card_type, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, updated_at)
       VALUES ('stale', ?, ?, ?, 'recognition', 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0)`,
    ).bind(kid, wid, pid).run();
    expect((await queue(kid)).map(label)).toEqual(["word:학생/recognition"]);
  });
});
