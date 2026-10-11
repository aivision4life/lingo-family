// Library scope filter (M2.7): "learning" (has a card), "mine" (I added it), "all" (default).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProfileCreate } from "../../shared/profile";
import { phraseListSchema } from "../../shared/phrase";
import { wordCreatedSchema, wordListSchema, type WordCreate } from "../../shared/word";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;
let a: string; // adult A
let b: string; // adult B
let kid: string;

const profile = (name: string, over: Partial<ProfileCreate> = {}): ProfileCreate => ({
  name, avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 10, study_langs: ["ko"], ...over,
});
const createProfile = async (p: ProfileCreate) => ((await t.api("POST", "/profiles", p)).body as { id: string }).id;

const word = (term: string, by: string, over: Partial<WordCreate> = {}): WordCreate => ({
  profile_id: by, lang: "ko", term, reading: term, pos: "noun", gloss_vi: `vi ${term}`, gloss_en: `en ${term}`, gloss_ko: `ko ${term}`,
  hanja: null, han_viet: null, emoji: null, ai_generated: false, examples: [], phrases: [], ...over,
});
const createWord = async (term: string, by: string, over: Partial<WordCreate> = {}) => {
  const res = await t.api("POST", "/words", word(term, by, over));
  return { status: res.status, body: wordCreatedSchema.parse(res.body) };
};
const words = async (params: string) => wordListSchema.parse((await t.api("GET", `/words?${params}`)).body).map((w) => w.term);
const phrases = async (params: string) => phraseListSchema.parse((await t.api("GET", `/phrases?${params}`)).body).map((p) => p.text);

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["review_logs", "cards", "profile_decks", "deck_words", "decks", "examples", "phrases", "words", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  a = await createProfile(profile("A"));
  b = await createProfile(profile("B", { name: "B" }));
  kid = await createProfile(profile("Kid", { name: "Kid", is_kid: true }));
});

describe("scope=all (default)", () => {
  it("is unchanged: no profile_id needed, shows everything", async () => {
    await createWord("회사", a);
    await createWord("학교", b);
    expect((await words("")).sort()).toEqual(["학교", "회사"]);
    expect((await words("scope=all")).sort()).toEqual(["학교", "회사"]);
  });
});

describe("scope=learning", () => {
  it("requires profile_id (400 without it)", async () => {
    expect((await t.api("GET", "/words?scope=learning")).status).toBe(400);
  });

  it("a word the profile has a card for (own word or someone else's, same language)", async () => {
    await createWord("회사", a);
    await createWord("학교", a);
    await t.api("PATCH", `/profiles/${a}`, { study_langs: ["ko"] }); // triggers nothing extra; cards already synced on create
    expect((await words(`scope=learning&profile_id=${a}`)).sort()).toEqual(["학교", "회사"]);
  });

  it("B creates a word; it is NOT in A's learning scope (A has no card), but is in all", async () => {
    await createWord("회사", b);
    expect(await words(`scope=learning&profile_id=${a}`)).toEqual([]);
    expect(await words(`scope=learning&profile_id=${b}`)).toEqual(["회사"]);
    expect(await words("scope=all")).toEqual(["회사"]);
  });

  it("not in the creator's study_langs → not in their own learning scope either", async () => {
    const only_en = await createProfile(profile("EN", { name: "EN", study_langs: ["en"] }));
    const res = await createWord("회사", only_en); // ko word, profile studies only en
    expect(res.body.added_to_learning).toBe(false);
    expect(await words(`scope=learning&profile_id=${only_en}`)).toEqual([]);
    expect(await words(`scope=mine&profile_id=${only_en}`)).toEqual(["회사"]);
  });

  it("phrases follow their root word's cards, not the phrase's own creator", async () => {
    const id = await createWord("회사", a);
    await t.api("POST", `/words/${id.body.id}/phrases`, {
      profile_id: b,
      phrases: [{ text: "회사원", reading: "x", gloss_vi: "v", gloss_en: "e", gloss_ko: "k", ai_generated: false, example: null }],
    });
    // The root word has cards for A (its creator); the phrase (created by B) follows the root word.
    expect(await phrases(`scope=learning&profile_id=${a}`)).toEqual(["회사원"]);
    expect(await phrases(`scope=learning&profile_id=${b}`)).toEqual([]); // B has no card of the root word
  });

  it("kid profiles can use every scope (read only)", async () => {
    await createWord("회사", a);
    expect(await words(`scope=learning&profile_id=${kid}`)).toEqual([]);
    await t.api("PATCH", `/profiles/${kid}`, { study_langs: ["ko"] });
    // A kid never gets their own cards from someone else creating a word; only Home sync would add theirs.
    expect(await words(`scope=all`)).toEqual(["회사"]);
  });
});

describe("scope=mine", () => {
  it("requires profile_id", async () => {
    expect((await t.api("GET", "/words?scope=mine")).status).toBe(400);
  });

  it("only words created by that profile", async () => {
    await createWord("회사", a);
    await createWord("학교", b);
    expect(await words(`scope=mine&profile_id=${a}`)).toEqual(["회사"]);
    expect(await words(`scope=mine&profile_id=${b}`)).toEqual(["학교"]);
  });

  it("a phrase's 'mine' is the phrase's own creator, not the root word's", async () => {
    const id = await createWord("회사", a);
    await t.api("POST", `/words/${id.body.id}/phrases`, {
      profile_id: b,
      phrases: [{ text: "회사원", reading: "x", gloss_vi: "v", gloss_en: "e", gloss_ko: "k", ai_generated: false, example: null }],
    });
    expect(await phrases(`scope=mine&profile_id=${b}`)).toEqual(["회사원"]);
    expect(await phrases(`scope=mine&profile_id=${a}`)).toEqual([]);
  });
});

describe("scope combines with lang / q / album (AND)", () => {
  it("narrows further, never widens", async () => {
    await createWord("회사", a, { lang: "ko" });
    await createWord("apple", a, { lang: "en" });
    expect(await words(`scope=mine&profile_id=${a}&lang=ko`)).toEqual(["회사"]);
    expect(await words(`scope=mine&profile_id=${a}&q=apple`)).toEqual(["apple"]);
    expect(await words(`scope=mine&profile_id=${a}&q=nope`)).toEqual([]);
  });
});

describe("created_by_profile is set on every creation path", () => {
  it("word creation, and a phrase added afterwards both record their own creator", async () => {
    const id = await createWord("회사", a);
    const row = await t.env.DB.prepare("SELECT created_by_profile FROM words WHERE id = ?").bind(id.body.id).first();
    expect(row).toEqual({ created_by_profile: a });

    await t.api("POST", `/words/${id.body.id}/phrases`, {
      profile_id: b,
      phrases: [{ text: "회사원", reading: "x", gloss_vi: "v", gloss_en: "e", gloss_ko: "k", ai_generated: false, example: null }],
    });
    const prow = await t.env.DB.prepare("SELECT created_by_profile FROM phrases WHERE text = '회사원'").first();
    expect(prow).toEqual({ created_by_profile: b });
  });

  it("phrases saved together with the word (ticked at save time) record the word's creator", async () => {
    await createWord("학교", a, {
      phrases: [{ text: "초등학교", reading: "x", gloss_vi: "v", gloss_en: "e", gloss_ko: "k", ai_generated: false, example: null }],
    });
    const row = await t.env.DB.prepare("SELECT created_by_profile FROM phrases WHERE text = '초등학교'").first();
    expect(row).toEqual({ created_by_profile: a });
  });
});

describe("a new word shows up in 'learning' right away (M2.7)", () => {
  it("without calling /review/summary first", async () => {
    await createWord("회사", a);
    expect(await words(`scope=learning&profile_id=${a}`)).toEqual(["회사"]);
  });

  it("added_to_learning is true when the language is studied", async () => {
    const res = await createWord("회사", a);
    expect(res.body.added_to_learning).toBe(true);
  });
});
