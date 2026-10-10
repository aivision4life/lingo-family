// Albums (M2.4): lifecycle, membership, language rule, listing/cover/unsorted, review filter.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { albumListSchema } from "../../shared/album";
import type { PhraseInput } from "../../shared/phrase";
import type { ProfileCreate } from "../../shared/profile";
import { queueResponseSchema, summarySchema } from "../../shared/review";
import { wordDetailSchema, wordListSchema, type WordCreate } from "../../shared/word";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;
const TZ = 540;
let adult: string;
let kid: string;

const profile = (over: Partial<ProfileCreate> = {}): ProfileCreate => ({
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 10, study_langs: ["ko", "en"], ...over,
});
const phrase = (text: string): PhraseInput => ({
  text, reading: text, gloss_vi: "v", gloss_en: "e", gloss_ko: "k", ai_generated: false, example: null,
});
const word = (term: string, over: Partial<WordCreate> = {}): WordCreate => ({
  profile_id: adult, lang: "ko", term, reading: term, pos: "noun", gloss_vi: `vi ${term}`, gloss_en: `en ${term}`, gloss_ko: `ko ${term}`,
  hanja: null, han_viet: null, emoji: null, ai_generated: false, examples: [], phrases: [], ...over,
});
const createWord = async (term: string, over: Partial<WordCreate> = {}) =>
  ((await t.api("POST", "/words", word(term, over))).body as { id: string }).id;
const createAlbum = async (name: string, lang = "ko", by = adult) => t.api("POST", "/albums", { profile_id: by, name, lang });
const albumId = async (name: string, lang = "ko") => ((await createAlbum(name, lang)).body as { id: string }).id;
const list = async (lang?: string) => albumListSchema.parse((await t.api("GET", `/albums${lang ? `?lang=${lang}` : ""}`)).body);
const add = (album: string, ids: string[], by = adult) => t.api("POST", `/albums/${album}/words`, { profile_id: by, word_ids: ids });
const remove = (album: string, ids: string[], by = adult) => t.api("DELETE", `/albums/${album}/words`, { profile_id: by, word_ids: ids });
const wordsIn = async (album: string) => wordListSchema.parse((await t.api("GET", `/words?album=${album}`)).body).map((w) => w.term);
const memberCount = async (album: string) =>
  (await t.env.DB.prepare("SELECT count(*) AS n FROM deck_words WHERE deck_id = ?").bind(album).first<{ n: number }>())?.n;

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["review_logs", "cards", "profile_decks", "deck_words", "decks", "examples", "phrases", "words", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  adult = ((await t.api("POST", "/profiles", profile())).body as { id: string }).id;
  kid = ((await t.api("POST", "/profiles", profile({ name: "Bé", is_kid: true }))).body as { id: string }).id;
});

describe("album lifecycle", () => {
  it("adults create, rename and delete; names are normalized and unique per language (case-insensitive)", async () => {
    const res = await createAlbum("  Office   words ");
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;
    expect((await list()).albums).toMatchObject([{ id, name: "Office words", lang: "ko", word_count: 0, cover: null }]);

    const dup = await createAlbum("office WORDS");
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ error: "duplicate_album", existing_id: id });
    expect((await createAlbum("Office words", "en")).status).toBe(201); // same name, other language: fine

    const other = await albumId("Food");
    expect((await t.api("PATCH", `/albums/${other}`, { profile_id: adult, name: "office words" })).status).toBe(409);
    expect((await t.api("PATCH", `/albums/${other}`, { profile_id: adult, name: "Snacks" })).status).toBe(200);
    expect((await list("ko")).albums.map((a) => a.name)).toEqual(["Office words", "Snacks"]);
  });

  it("rejects names longer than 60 characters and empty names", async () => {
    expect((await createAlbum("x".repeat(61))).status).toBe(400);
    expect((await createAlbum("x".repeat(60))).status).toBe(201);
    expect((await createAlbum("   ")).status).toBe(400);
  });

  it("kid profiles can read but never create, rename, delete or change membership", async () => {
    const id = await albumId("Office");
    const w = await createWord("회사");
    expect((await createAlbum("Kid album", "ko", kid)).status).toBe(403);
    expect((await t.api("PATCH", `/albums/${id}`, { profile_id: kid, name: "x" })).status).toBe(403);
    expect((await t.api("DELETE", `/albums/${id}`, { profile_id: kid })).status).toBe(403);
    expect((await add(id, [w], kid)).status).toBe(403);
    expect((await remove(id, [w], kid)).status).toBe(403);
    expect((await t.api("PUT", `/words/${w}/albums`, { profile_id: kid, album_ids: [id] })).status).toBe(403);
    expect((await list()).albums).toHaveLength(1); // reading is open
  });

  it("deleting an album keeps its words; default decks are not albums", async () => {
    const id = await albumId("Office");
    const w = await createWord("회사");
    await add(id, [w]);
    expect((await t.api("DELETE", `/albums/${id}`, { profile_id: adult })).status).toBe(204);
    expect(await memberCount(id)).toBe(0);
    expect((await t.api("GET", `/words/${w}`)).status).toBe(200);

    await t.api("GET", `/review/summary?profile_id=${adult}&tz=${TZ}`); // creates default-ko / default-en
    expect((await list()).albums).toEqual([]); // default decks are hidden
    expect((await t.api("DELETE", "/albums/default-ko", { profile_id: adult })).status).toBe(404);
    expect((await t.api("PATCH", "/albums/default-ko", { profile_id: adult, name: "x" })).status).toBe(404);
    expect(await t.env.DB.prepare("SELECT count(*) AS n FROM decks WHERE id = 'default-ko'").first()).toEqual({ n: 1 });
  });
});

describe("membership", () => {
  it("adds and removes words; re-adding is harmless; counts are reported", async () => {
    const id = await albumId("Office");
    const [a, b] = [await createWord("회사"), await createWord("학교")];
    expect((await add(id, [a, b])).body).toEqual({ changed: 2 });
    expect((await add(id, [a])).body).toEqual({ changed: 0 });
    expect(await memberCount(id)).toBe(2);
    expect((await remove(id, [a])).body).toEqual({ changed: 1 });
    expect(await wordsIn(id)).toEqual(["학교"]);
  });

  it("one word can be in many albums; the word detail lists them", async () => {
    const [x, y] = [await albumId("A"), await albumId("B")];
    const w = await createWord("회사");
    await add(x, [w]);
    await add(y, [w]);
    expect(wordDetailSchema.parse((await t.api("GET", `/words/${w}`)).body).albums.map((a) => a.name)).toEqual(["A", "B"]);
  });

  it("a word and an album must share a language (API and database)", async () => {
    const ko = await albumId("Korean", "ko");
    const en = await createWord("apple", { lang: "en" });
    const res = await add(ko, [en]);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "album_language_mismatch" });
    // The trigger is the safety net behind the API check.
    await expect(t.env.DB.prepare("INSERT INTO deck_words (deck_id, word_id) VALUES (?, ?)").bind(ko, en).run()).rejects.toThrow(/languages differ/);
    expect((await add(ko, ["missing-id"])).status).toBe(404);
  });

  it("PUT /words/:id/albums replaces the set (adds and removes)", async () => {
    const [x, y, z] = [await albumId("A"), await albumId("B"), await albumId("C")];
    const w = await createWord("회사");
    await add(x, [w]);
    const res = await t.api("PUT", `/words/${w}/albums`, { profile_id: adult, album_ids: [y, z] });
    expect((res.body as { albums: { name: string }[] }).albums.map((a) => a.name)).toEqual(["B", "C"]);
    expect(await wordsIn(x)).toEqual([]);
    expect((await t.api("PUT", `/words/${w}/albums`, { profile_id: adult, album_ids: [] })).status).toBe(200);
    expect(await memberCount(y)).toBe(0);
    const enAlbum = await albumId("English", "en");
    expect((await t.api("PUT", `/words/${w}/albums`, { profile_id: adult, album_ids: [enAlbum] })).status).toBe(400);
  });

  it("choosing albums while adding a word; wrong language or unknown album stops the save", async () => {
    const ko = await albumId("Office");
    const en = await albumId("English words", "en");
    const id = await createWord("회사", { album_ids: [ko] });
    expect(await wordsIn(ko)).toEqual(["회사"]);
    expect(id).toBeTruthy();

    const bad = await t.api("POST", "/words", word("학교", { album_ids: [en] }));
    expect(bad.status).toBe(400);
    expect((await t.api("POST", "/words", word("학교", { album_ids: ["nope"] }))).status).toBe(404);
    expect(await t.env.DB.prepare("SELECT count(*) AS n FROM words WHERE term = '학교'").first()).toEqual({ n: 0 }); // nothing saved
  });

  it("deleting a word removes it from its albums", async () => {
    const id = await albumId("Office");
    const w = await createWord("회사");
    await add(id, [w]);
    await t.api("DELETE", `/words/${w}`, { profile_id: adult });
    expect(await memberCount(id)).toBe(0);
    expect((await list()).albums[0]!.word_count).toBe(0);
  });
});

describe("listing", () => {
  it("counts words, picks a cover (first-added word with a ready image, else an emoji) and lists the unsorted words", async () => {
    const id = await albumId("Office");
    const [a, b, c] = [await createWord("회사", { emoji: "🏢" }), await createWord("학교", { emoji: "🏫" }), await createWord("집")];
    await t.env.DB.prepare("UPDATE words SET image_status = 'ready', image_key = 'images/ai/b.png' WHERE id = ?").bind(b).run();
    await t.env.DB.prepare("INSERT INTO deck_words (deck_id, word_id, added_at) VALUES (?, ?, 100), (?, ?, 200)").bind(id, a, id, b).run();

    let album = (await list()).albums[0]!;
    expect(album).toMatchObject({ word_count: 2, cover: { image_key: "images/ai/b.png", image_status: "ready" } });

    await t.env.DB.prepare("UPDATE words SET image_status = 'none', image_key = NULL WHERE id = ?").bind(b).run();
    album = (await list()).albums[0]!;
    expect(album.cover).toMatchObject({ image_key: null, emoji: "🏢" }); // oldest membership with an emoji

    expect((await list()).unsorted).toEqual([{ lang: "ko", word_count: 1 }, { lang: "en", word_count: 0 }]);
    expect(await wordsIn("none")).toEqual(["집"]);
    expect(c).toBeTruthy();
  });

  it("an album's words are listed most recently added first", async () => {
    const id = await albumId("Office");
    const [a, b] = [await createWord("회사"), await createWord("학교")];
    await t.env.DB.prepare("INSERT INTO deck_words (deck_id, word_id, added_at) VALUES (?, ?, 100), (?, ?, 900)").bind(id, a, id, b).run();
    expect(await wordsIn(id)).toEqual(["학교", "회사"]);
  });
});

describe("review by album", () => {
  const queue = async (pid: string, album?: string, lang = "ko") =>
    queueResponseSchema.parse((await t.api("GET", `/review/queue?profile_id=${pid}&lang=${lang}&tz=${TZ}${album ? `&album=${album}` : ""}`)).body).items;
  const answer = (pid: string, cardId: string) => t.api("POST", "/review/answer", { profile_id: pid, card_id: cardId, rating: 3, duration_ms: 1 });
  const label = (i: { word: { kind: string; term: string }; card: { card_type: string } }) => `${i.word.kind}:${i.word.term}/${i.card.card_type}`;

  it("only the album's cards are queued; phrases follow their root word; the unlock chain is intact", async () => {
    const id = await albumId("Office");
    const w = await createWord("회사", { phrases: [phrase("회사원")] });
    await createWord("학교");
    await add(id, [w]);
    expect((await queue(adult)).map(label).sort()).toEqual(["phrase:회사원/recognition", "word:학교/recognition", "word:회사/recognition"]);
    expect((await queue(adult, id)).map(label).sort()).toEqual(["phrase:회사원/recognition", "word:회사/recognition"]);
  });

  it("the schedule and the daily new-card limit are shared: the limit counts the whole language, not the album", async () => {
    await t.api("PATCH", `/profiles/${adult}`, { daily_new_limit: 1 });
    const [x, y] = [await albumId("A"), await albumId("B")];
    const [a, b] = [await createWord("회사"), await createWord("학교")];
    await add(x, [a]);
    await add(y, [b]);

    const first = (await queue(adult, x))[0]!;
    expect((await answer(adult, first.card.id)).status).toBe(200);
    // The one new card of today is used up in the language: album B offers no new recognition card.
    expect((await queue(adult, y)).filter((i) => i.card.reps === 0 && i.card.card_type === "recognition")).toEqual([]);
    // The same card, answered through the album, is also what the full queue sees.
    expect((await queue(adult)).find((i) => i.card.id === first.card.id)?.card.reps).toBe(1);
  });

  it("summary lists the albums of each language with their own counts; empty albums are left out", async () => {
    const id = await albumId("Office");
    await albumId("Empty");
    const w = await createWord("회사");
    await createWord("학교");
    await add(id, [w]);
    const summary = summarySchema.parse((await t.api("GET", `/review/summary?profile_id=${adult}&tz=${TZ}`)).body);
    const ko = summary.find((s) => s.lang === "ko")!;
    expect(ko.new).toBe(2);
    expect(ko.albums).toEqual([{ id, name: "Office", due: 0, new: 1 }]);
    expect(summary.find((s) => s.lang === "en")!.albums).toEqual([]);
  });

  it("an album of another language, or an unknown one, is refused", async () => {
    const en = await albumId("English words", "en");
    expect((await t.api("GET", `/review/queue?profile_id=${adult}&lang=ko&tz=${TZ}&album=${en}`)).status).toBe(404);
    expect((await t.api("GET", `/review/queue?profile_id=${adult}&lang=ko&tz=${TZ}&album=nope`)).status).toBe(404);
    expect((await t.api("GET", `/review/queue?profile_id=${adult}&lang=ko&tz=${TZ}&album=default-ko`)).status).toBe(404);
  });

  it("kid profiles can review an album (no phrase cards) but have no write access", async () => {
    const id = await albumId("Office");
    const w = await createWord("회사", { phrases: [phrase("회사원")] });
    await add(id, [w]);
    expect((await queue(kid, id)).map(label)).toEqual(["word:회사/recognition"]);
  });

  it("albums create no cards and do not change which cards exist", async () => {
    const id = await albumId("Office");
    const w = await createWord("회사");
    await add(id, [w]);
    await queue(adult);
    const before = (await t.env.DB.prepare("SELECT count(*) AS n FROM cards").first<{ n: number }>())?.n;
    await queue(adult, id);
    await queue(adult);
    expect((await t.env.DB.prepare("SELECT count(*) AS n FROM cards").first<{ n: number }>())?.n).toBe(before);
    expect(await t.env.DB.prepare("SELECT count(*) AS n FROM profile_decks WHERE deck_id = ?").bind(id).first()).toEqual({ n: 0 });
  });
});
