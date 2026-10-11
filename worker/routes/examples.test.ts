// Add / edit / delete example sentences (M2.6): permissions, limits, TTS only when the text changes,
// redraw keeps the old picture, deleting keeps practice history.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sentenceChanged } from "../../shared/exampleEdit";
import type { PhraseInput } from "../../shared/phrase";
import type { ProfileCreate } from "../../shared/profile";
import { wordDetailSchema, type WordCreate } from "../../shared/word";
import { fakeImageAi } from "../test/fakeImageAi";
import { fakeTts } from "../test/fakeTts";
import { createTestEnv, testApp } from "../test/testEnv";

const tts = fakeTts();
const images = fakeImageAi();
let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult: string;
let kid: string;

const profile = (name: string, is_kid: boolean): ProfileCreate => ({
  name, avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid, daily_new_limit: 5, study_langs: ["ko"],
});
const ex = (sentence: string) => ({ sentence, translation_vi: "vi", translation_en: "en", translation_ko: "", level: "beginner" as const, ai_generated: true });
const phrase = (text: string, withExample = false): PhraseInput => ({
  text, reading: text, gloss_vi: "v", gloss_en: "e", gloss_ko: "k", ai_generated: false, example: withExample ? ex(`${text} 문장`) : null,
});
const create = async (phrases: PhraseInput[] = []) =>
  ((await t.api("POST", "/words", {
    profile_id: adult, lang: "ko", term: "학생", reading: "haksaeng", pos: "noun", gloss_vi: "học sinh", gloss_en: "student", gloss_ko: "k",
    hanja: null, han_viet: null, emoji: null, ai_generated: false, examples: [ex("첫째 문장"), ex("둘째 문장")], phrases,
  } satisfies WordCreate)).body as { id: string }).id;
const detail = async (id: string) => wordDetailSchema.parse((await t.api("GET", `/words/${id}`)).body);
const add = (wordId: string, body: Record<string, unknown>) => t.api("POST", `/words/${wordId}/examples`, { profile_id: adult, ...body });
const patch = (id: string, body: Record<string, unknown>, by = adult) => t.api("PATCH", `/examples/${id}`, { profile_id: by, ...body });
const row = (id: string) =>
  t.env.DB.prepare("SELECT sentence, translation_vi, translation_en, translation_ko, audio_key, image_key, image_status, image_nonce, image_prompt FROM examples WHERE id = ?")
    .bind(id)
    .first<Record<string, string | null>>();

beforeAll(async () => {
  t = await createTestEnv(testApp({ makeTts: () => tts.client, makeImageAi: () => images.ai }));
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["pron_attempts", "examples", "phrases", "words", "usage_daily", "profiles"]) await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  tts.calls.length = 0;
  images.calls.length = 0;
  images.state.gate = null;
  adult = ((await t.api("POST", "/profiles", profile("Bố", false))).body as { id: string }).id;
  kid = ((await t.api("POST", "/profiles", profile("Bé", true))).body as { id: string }).id;
});

describe("POST /api/words/:id/examples", () => {
  it("adds a sentence with audio at once; own-language translation is dropped; no prompt → picture is lazy", async () => {
    const id = await create();
    tts.calls.length = 0;
    const res = await add(id, { sentence: " 셋째   문장 ", translation_vi: "Câu thứ ba", translation_en: "Third", translation_ko: "should go" });
    expect(res.status).toBe(201);
    const newId = (res.body as { id: string }).id;
    expect(tts.calls.map((c) => c.text)).toEqual(["셋째 문장"]);
    expect(await row(newId)).toMatchObject({ sentence: "셋째 문장", translation_vi: "Câu thứ ba", translation_ko: "", image_status: "none" });
    expect((await row(newId))!.audio_key).toMatch(/^audio\/ko\//);
    expect((await detail(id)).examples).toHaveLength(3);
  });

  it("with an image prompt the picture is drawn in the background", async () => {
    const id = await create();
    // Hold the drawing "in flight" so the pending state can be observed without a race.
    let release!: () => void;
    images.state.gate = new Promise<void>((r) => (release = r));
    const newId = ((await add(id, { sentence: "셋째 문장", image_prompt: "A child studying at a desk with books" })).body as { id: string }).id;
    expect((await row(newId))!.image_status).toBe("pending");
    release();
    images.state.gate = null;
    await t.settle();
    expect(await row(newId)).toMatchObject({ image_status: "ready" });
    expect(images.calls).toHaveLength(1);
  });

  it("at most 5 sentences per word, 1 per phrase; the same sentence twice is refused", async () => {
    const id = await create([phrase("대학생")]);
    for (const s of ["셋째", "넷째", "다섯째"]) expect((await add(id, { sentence: s })).status).toBe(201);
    const sixth = await add(id, { sentence: "여섯째" });
    expect(sixth.status).toBe(409);
    expect(sixth.body).toMatchObject({ error: "too_many_examples" });
    expect((await add(id, { sentence: "첫째 문장" })).status).toBe(409);

    const phraseId = (await detail(id)).phrases[0]!.id;
    expect((await add(id, { sentence: "대학생이에요", phrase_id: phraseId })).status).toBe(201);
    expect((await add(id, { sentence: "또 다른 문장", phrase_id: phraseId })).body).toMatchObject({ error: "too_many_examples" });
    // The phrase's example belongs to the phrase, not to the word's five.
    expect((await detail(id)).examples).toHaveLength(5);
    expect((await detail(id)).phrases[0]!.examples).toHaveLength(1);
  });

  it("a phrase of another word, or an unknown word, is not found", async () => {
    const a = await create([phrase("대학생")]);
    const other = ((await t.api("POST", "/words", {
      profile_id: adult, lang: "ko", term: "학교", reading: "x", pos: "noun", gloss_vi: "v", gloss_en: "e", gloss_ko: "k", hanja: null, han_viet: null, emoji: null, ai_generated: false, examples: [], phrases: [],
    })).body as { id: string }).id;
    const phraseId = (await detail(a)).phrases[0]!.id;
    expect((await add(other, { sentence: "문장", phrase_id: phraseId })).status).toBe(404);
    expect((await add("nope", { sentence: "문장" })).status).toBe(404);
  });

  it("kid profiles get 403; bad input 400", async () => {
    const id = await create();
    expect((await t.api("POST", `/words/${id}/examples`, { profile_id: kid, sentence: "문장" })).status).toBe(403);
    expect((await add(id, { sentence: "" })).status).toBe(400);
    expect((await add(id, { sentence: "x", image_prompt: "short" })).status).toBe(400);
  });
});

describe("PATCH /api/examples/:id", () => {
  const first = async (id: string) => (await detail(id)).examples[0]!;

  it("changed text → audio is made again from the new text; the old file stays in R2", async () => {
    const id = await create();
    const ex1 = await first(id);
    const oldKey = (await row(ex1.id))!.audio_key!;
    expect(await t.env.MEDIA.head(oldKey)).not.toBeNull();
    tts.calls.length = 0;

    expect((await patch(ex1.id, { sentence: "완전히 새로운 문장" })).status).toBe(200);
    const after = (await row(ex1.id))!;
    expect(after.sentence).toBe("완전히 새로운 문장");
    expect(tts.calls.map((c) => c.text)).toEqual(["완전히 새로운 문장"]);
    expect(after.audio_key).not.toBe(oldKey);
    expect(await t.env.MEDIA.head(after.audio_key!)).not.toBeNull();
    expect(await t.env.MEDIA.head(oldKey)).not.toBeNull(); // content-addressed: the old file is kept
  });

  it("only translations → no TTS, same audio, no drawing, no AI", async () => {
    const id = await create();
    const ex1 = await first(id);
    const before = (await row(ex1.id))!;
    tts.calls.length = 0;
    images.calls.length = 0;
    expect((await patch(ex1.id, { translation_vi: "Bản dịch mới", translation_ko: "x" })).status).toBe(200);
    await t.settle();
    const after = (await row(ex1.id))!;
    expect(after).toMatchObject({ translation_vi: "Bản dịch mới", audio_key: before.audio_key, image_nonce: before.image_nonce });
    expect(after.translation_ko).toBe(""); // own language stays empty
    expect(tts.calls).toHaveLength(0);
    expect(images.calls).toHaveLength(0);
  });

  it("whitespace or Unicode-form changes are not a text change (no TTS)", async () => {
    const id = await create();
    const ex1 = await first(id);
    tts.calls.length = 0;
    await patch(ex1.id, { sentence: "  첫째   문장 " });
    expect(tts.calls).toHaveLength(0);
    expect((await row(ex1.id))!.sentence).toBe("첫째 문장");
  });

  it("redraw_image: new prompt, new nonce, a new picture; the previous picture stays in R2", async () => {
    const id = await create();
    const ex1 = await first(id);
    // Give the example a first picture.
    await patch(ex1.id, { image_prompt: "A student reading a book in a library", redraw_image: true });
    await t.settle();
    const firstPic = (await row(ex1.id))!;
    expect(firstPic.image_status).toBe("ready");
    expect(await t.env.MEDIA.head(firstPic.image_key!)).not.toBeNull();

    images.calls.length = 0;
    await patch(ex1.id, { sentence: "새로운 장면의 문장", image_prompt: "Two students walking to school in the rain", redraw_image: true });
    await t.settle();
    const secondPic = (await row(ex1.id))!;
    expect(secondPic.image_nonce).not.toBe(firstPic.image_nonce);
    expect(secondPic.image_prompt).toBe("Two students walking to school in the rain");
    expect(images.calls).toHaveLength(1);
    expect(await t.env.MEDIA.head(firstPic.image_key!)).not.toBeNull(); // the old picture is kept
  });

  it("redraw_image needs a prompt; without redraw_image the picture is never touched", async () => {
    const id = await create();
    const ex1 = await first(id);
    expect((await patch(ex1.id, { redraw_image: true })).status).toBe(400);
    images.calls.length = 0;
    await patch(ex1.id, { sentence: "그림은 그대로" });
    await t.settle();
    expect(images.calls).toHaveLength(0);
  });

  it("renaming into an existing sentence of the same owner is refused", async () => {
    const id = await create();
    const ex1 = await first(id);
    expect((await patch(ex1.id, { sentence: "둘째 문장" })).status).toBe(409);
  });

  it("kid profiles get 403, unknown ids 404", async () => {
    const id = await create();
    expect((await patch((await first(id)).id, { translation_vi: "x" }, kid)).status).toBe(403);
    expect((await patch("nope", { translation_vi: "x" })).status).toBe(404);
  });
});

describe("DELETE /api/examples/:id", () => {
  const del = (id: string, by = adult) => t.api("DELETE", `/examples/${id}`, { profile_id: by });

  it("deletes only that sentence; practice history keeps its row with the link set to NULL", async () => {
    const id = await create([phrase("대학생", true)]);
    const d = await detail(id);
    const target = d.examples[0]!;
    await t.env.DB.prepare(
      `INSERT INTO pron_attempts (id, profile_id, word_id, example_id, lang, reference_text, pron_score, accuracy, fluency, completeness, created_at)
       VALUES ('pa1', ?, ?, ?, 'ko', ?, 90, 90, 90, 100, 1), ('pa2', ?, ?, ?, 'ko', ?, 70, 70, 70, 100, 2)`,
    ).bind(adult, id, target.id, target.sentence, adult, id, d.examples[1]!.id, d.examples[1]!.sentence).run();

    expect((await del(target.id)).status).toBe(204);
    const after = await detail(id);
    expect(after.examples.map((e) => e.id)).toEqual([d.examples[1]!.id]);
    expect(after.phrases).toHaveLength(1); // the phrase and its example are untouched
    expect(after.phrases[0]!.examples).toHaveLength(1);

    const attempts = await t.env.DB.prepare("SELECT id, example_id, reference_text FROM pron_attempts ORDER BY id").all<{ id: string; example_id: string | null; reference_text: string }>();
    expect(attempts.results).toEqual([
      { id: "pa1", example_id: null, reference_text: target.sentence },
      { id: "pa2", example_id: d.examples[1]!.id, reference_text: d.examples[1]!.sentence },
    ]);
  });

  it("a phrase's sentence can be deleted and added again", async () => {
    const id = await create([phrase("대학생", true)]);
    const p = (await detail(id)).phrases[0]!;
    expect((await del(p.examples[0]!.id)).status).toBe(204);
    expect((await add(id, { sentence: "새 문장", phrase_id: p.id })).status).toBe(201);
  });

  it("kid profiles get 403; unknown ids 404", async () => {
    const id = await create();
    expect((await del((await detail(id)).examples[0]!.id, kid)).status).toBe(403);
    expect((await del("nope")).status).toBe(404);
  });
});

describe("sentenceChanged", () => {
  it("ignores spacing and Unicode form, notices real edits", () => {
    expect(sentenceChanged("한 글", "  한   글 ")).toBe(false);
    expect(sentenceChanged("한글", "한글!")).toBe(true);
    expect(sentenceChanged("é", "é")).toBe(false); // é written two ways
  });
});
