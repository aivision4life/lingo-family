// Images (M1.8B): drawing after save, fallback model, R2 reuse, quotas, redraw/retry/upload.
// Workers AI is always a fake here (never the real binding).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IMAGE_DAILY_QUOTA, IMAGE_FAMILY_DAILY_CAP, imageStateSchema } from "../../shared/image";
import type { PhraseInput } from "../../shared/phrase";
import type { ProfileCreate } from "../../shared/profile";
import { wordDetailSchema, type WordCreate } from "../../shared/word";
import { usageDate } from "../lib/quota";
import { FAKE_JPEG, fakeImageAi } from "../test/fakeImageAi";
import { createTestEnv, testApp } from "../test/testEnv";

const KLEIN = "@cf/black-forest-labs/flux-2-klein-4b";
const SCHNELL = "@cf/black-forest-labs/flux-1-schnell";
const fake = fakeImageAi();
let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult: string;
let kid: string;

const profile = (over: Partial<ProfileCreate> = {}): ProfileCreate => ({
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 10, study_langs: ["ko"], ...over,
});
const phrase = (text: string, image_prompt: string | null = `picture of ${text}`): PhraseInput => ({
  text, reading: text, gloss_vi: "v", gloss_en: `en ${text}`, gloss_ko: "k", ai_generated: true, image_prompt,
  example: { sentence: `${text} 문장`, translation_vi: "v", translation_en: `a sentence with ${text}`, translation_ko: "", level: "beginner", ai_generated: true },
});
const word = (term: string, over: Partial<WordCreate> = {}): WordCreate => ({
  profile_id: adult, lang: "ko", term, reading: term, pos: "noun", gloss_vi: "v", gloss_en: `en ${term}`, gloss_ko: "k",
  hanja: null, han_viet: null, emoji: "🍎", ai_generated: true, image_prompt: `a picture of ${term}`,
  examples: [{ sentence: `${term} 예문`, translation_vi: "v", translation_en: `I see ${term}`, translation_ko: "", level: "beginner", ai_generated: true }],
  phrases: [], ...over,
});
const create = async (term: string, over: Partial<WordCreate> = {}) =>
  ((await t.api("POST", "/words", word(term, over))).body as { id: string }).id;
const detail = async (id: string) => wordDetailSchema.parse((await t.api("GET", `/words/${id}`)).body);
const row = (table: string, id: string) =>
  t.env.DB.prepare(`SELECT image_status, image_key, image_model, image_source, image_nonce FROM ${table} WHERE id = ?`).bind(id).first();
const imageUsage = async (pid: string) =>
  (await t.env.DB.prepare("SELECT count FROM usage_daily WHERE profile_id = ? AND service = 'image'").bind(pid).first<{ count: number }>())?.count ?? 0;
const setUsage = (pid: string, n: number) =>
  t.env.DB.prepare("INSERT OR REPLACE INTO usage_daily (date, profile_id, service, count) VALUES (?, ?, 'image', ?)").bind(usageDate(), pid, n).run();
const post = async (url: string, body: object) => {
  const r = await t.api("POST", url, body);
  return { status: r.status, body: r.status === 200 ? imageStateSchema.parse(r.body) : r.body };
};

beforeAll(async () => {
  t = await createTestEnv(testApp({ makeImageAi: () => fake.ai }));
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["examples", "phrases", "words", "usage_daily", "profiles"]) await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  fake.calls.length = 0;
  fake.state.behaviour = {};
  fake.state.gate = null;
  adult = ((await t.api("POST", "/profiles", profile())).body as { id: string }).id;
  kid = ((await t.api("POST", "/profiles", profile({ name: "Bé", is_kid: true }))).body as { id: string }).id;
});

describe("images drawn after saving", () => {
  it("word + selected phrases are pending at once, then ready (klein) after waitUntil; examples stay lazy", async () => {
    let release!: () => void;
    fake.state.gate = new Promise<void>((r) => (release = r)); // hold the drawing "in flight"
    const id = await create("사과", { phrases: [phrase("사과나무")] });
    const before = await detail(id);
    expect(before.image_status).toBe("pending");
    expect(before.phrases[0]!.image_status).toBe("pending");

    release();
    await t.settle();
    const d = await detail(id);
    expect(d).toMatchObject({ image_status: "ready", image_source: "ai" });
    expect(d.image_key).toMatch(/^images\/ai\/[0-9a-f]{40}\.jpg$/);
    expect(d.phrases[0]!.image_status).toBe("ready");
    expect(d.examples[0]!.image_status).toBe("none");
    expect(d.phrases[0]!.examples[0]!.image_status).toBe("none");
    expect(await row("words", id)).toMatchObject({ image_model: "flux-2-klein-4b", image_nonce: "0" });
    expect(fake.calls).toEqual([KLEIN, KLEIN]);
    expect(await imageUsage(adult)).toBe(2);

    const media = await t.raw(`/api/media/${d.image_key}`);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/jpeg");
    expect(media.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(FAKE_JPEG);
  });

  it("falls back to flux-1-schnell when klein fails (2 quota units) and records the model", async () => {
    fake.state.behaviour = { [KLEIN]: "error" };
    const id = await create("배");
    await t.settle();
    expect(await row("words", id)).toMatchObject({ image_status: "ready", image_model: "flux-1-schnell" });
    expect(fake.calls).toEqual([KLEIN, SCHNELL]);
    expect(await imageUsage(adult)).toBe(2);
  });

  it("both models fail → failed; words typed by hand (no prompt) are not drawn", async () => {
    fake.state.behaviour = { [KLEIN]: "error", [SCHNELL]: "error" };
    const failed = await create("감");
    const manual = await create("귤", { image_prompt: null, ai_generated: false });
    await t.settle();
    expect(await row("words", failed)).toMatchObject({ image_status: "failed", image_key: null });
    expect(await row("words", manual)).toMatchObject({ image_status: "none" });
    expect(fake.calls).toEqual([KLEIN, SCHNELL]);
  });

  it("an image already in R2 (same model + prompt + style + nonce) is reused without calling Workers AI", async () => {
    await create("사과", { image_prompt: "a red apple" });
    await t.settle();
    const second = await create("능금", { image_prompt: "a red apple" });
    await t.settle();
    expect(fake.calls).toHaveLength(1);
    expect(await row("words", second)).toMatchObject({ image_status: "ready", image_model: "flux-2-klein-4b" });
    expect(await imageUsage(adult)).toBe(1);
  });
});

describe("image quotas (60 per profile, 150 for the family)", () => {
  it("profile limit reached → the item keeps its placeholder (none), no AI call, no error", async () => {
    await setUsage(adult, IMAGE_DAILY_QUOTA);
    const id = await create("자두"); // a prompt never drawn before (R2 hits are free)
    await t.settle();
    expect(await row("words", id)).toMatchObject({ image_status: "none" });
    expect(fake.calls).toEqual([]);

    const retry = await post(`/images/word/${id}/retry`, { profile_id: adult });
    expect(retry).toMatchObject({ status: 200, body: { image_status: "none", quota: true } });
  });

  it("family cap counts all profiles together", async () => {
    const other = ((await t.api("POST", "/profiles", profile({ name: "Mẹ" }))).body as { id: string }).id;
    await setUsage(other, IMAGE_FAMILY_DAILY_CAP);
    const id = await create("복숭아");
    await t.settle();
    expect(await row("words", id)).toMatchObject({ image_status: "none" });
    await setUsage(other, IMAGE_FAMILY_DAILY_CAP - 1);
    expect((await post(`/images/word/${id}/retry`, { profile_id: adult })).body).toMatchObject({ image_status: "ready", quota: false });
  });
});

describe("redraw, retry, upload", () => {
  it("redraw: new prompt + nonce → new key, the old image stays in R2; kids are refused", async () => {
    const id = await create("사과");
    await t.settle();
    const first = await detail(id);
    expect((await post(`/images/word/${id}/redraw`, { profile_id: kid, image_prompt: "a green apple" })).status).toBe(403);

    const res = await post(`/images/word/${id}/redraw`, { profile_id: adult, image_prompt: "a green apple" });
    expect(res.body).toMatchObject({ image_status: "ready", image_prompt: "a green apple" });
    const after = await detail(id);
    expect(after.image_key).not.toBe(first.image_key);
    expect(await t.env.MEDIA.head(first.image_key!)).not.toBeNull();
    expect((await row("words", id))!.image_nonce).not.toBe("0");
  });

  it("a failed redraw keeps the previous image; retry draws it again", async () => {
    const id = await create("사과");
    await t.settle();
    const oldKey = (await detail(id)).image_key;
    fake.state.behaviour = { [KLEIN]: "error", [SCHNELL]: "error" };
    await post(`/images/word/${id}/redraw`, { profile_id: adult, image_prompt: "an apple tree" });
    expect(await detail(id)).toMatchObject({ image_status: "failed", image_key: oldKey });

    fake.state.behaviour = {};
    expect((await post(`/images/word/${id}/retry`, { profile_id: kid })).status).toBe(403);
    const retry = await post(`/images/word/${id}/retry`, { profile_id: adult });
    expect(retry.body).toMatchObject({ image_status: "ready" });
  });

  it("upload: WebP ≤ 512 px and ≤ 300 KB is stored as is; bad files and kids are refused", async () => {
    const id = await create("사과", { image_prompt: null });
    const webp = Uint8Array.from([..."RIFF\0\0\0\0WEBPVP8X"].map((ch) => ch.charCodeAt(0)).concat([10, 0, 0, 0, 0, 0, 0, 0, 0xff, 1, 0, 0xff, 1, 0]));
    const upload = (pid: string, body: Uint8Array, type = "image/webp") =>
      t.send(`/api/images/word/${id}/upload?profile_id=${pid}`, { method: "POST", headers: { "content-type": type }, body });

    expect((await upload(kid, webp)).status).toBe(403);
    expect((await upload(adult, webp, "image/png")).status).toBe(400); // type does not match the bytes
    const big = Uint8Array.from(webp);
    big.set([0xff, 3, 0], 24); // width 1024
    expect((await upload(adult, big)).status).toBe(400);

    const ok = await upload(adult, webp);
    expect(ok.status).toBe(200);
    expect(await row("words", id)).toMatchObject({ image_status: "ready", image_source: "upload", image_model: null });
    expect((await detail(id)).image_key).toMatch(/^images\/upload\/[0-9a-f]{40}\.webp$/);
    expect(fake.calls).toEqual([]);
  });
});
