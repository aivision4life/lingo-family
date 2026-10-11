// Images (M1.8B): lazy example images, claiming (no double drawing, stalled items), backfill, usage.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backfillResponseSchema, IMAGE_DAILY_QUOTA, IMAGE_FAMILY_DAILY_CAP, IMAGE_STALE_MS, usageSchema } from "../../shared/image";
import type { ProfileCreate } from "../../shared/profile";
import { wordDetailSchema } from "../../shared/word";
import type { LlmClient } from "../services/llm";
import { fakeImageAi } from "../test/fakeImageAi";
import { createTestEnv, testApp } from "../test/testEnv";

const fake = fakeImageAi();
/** Fake LLM for backfill: one image prompt per `ref` found in the request. */
const llmRequests: string[] = [];
const llm: LlmClient = {
  model: "fake",
  async generate(req) {
    llmRequests.push(req.user);
    const refs = [...req.user.matchAll(/ref (\S+)/g)].map((m) => m[1]!);
    return { text: JSON.stringify({ prompts: refs.map((ref) => ({ ref, image_prompt: `scene for ${ref}` })) }), model: "fake" };
  },
};

let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult: string;
let kid: string;
let seq = 0;

const profile = (over: Partial<ProfileCreate> = {}): ProfileCreate => ({
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 10, study_langs: ["ko"], ...over,
});
/** A word saved before M1.8: no image prompts anywhere, status none. Unique texts → no R2 reuse. */
async function oldWord() {
  const n = ++seq;
  const res = await t.api("POST", "/words", {
    profile_id: adult, lang: "ko", term: `낱말${n}`, reading: "r", pos: "noun", gloss_vi: "v", gloss_en: `thing ${n}`, gloss_ko: "k",
    hanja: null, han_viet: null, emoji: null, ai_generated: false,
    examples: [{ sentence: `예문 ${n}`, translation_vi: "v", translation_en: `example ${n}`, translation_ko: "", level: "beginner", ai_generated: false }],
    phrases: [{ text: `구 ${n}`, reading: "r", gloss_vi: "v", gloss_en: `phrase ${n}`, gloss_ko: "k", ai_generated: false, example: null }],
  });
  return (res.body as { id: string }).id;
}
const detail = async (id: string) => wordDetailSchema.parse((await t.api("GET", `/words/${id}`)).body);
const hold = () => {
  let release!: () => void;
  fake.state.gate = new Promise<void>((r) => (release = r));
  return () => release();
};

beforeAll(async () => {
  t = await createTestEnv(testApp({ makeImageAi: () => fake.ai, makeLlm: () => llm }));
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["examples", "phrases", "words", "usage_daily", "profiles"]) await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  fake.calls.length = 0;
  fake.state.gate = null;
  llmRequests.length = 0;
  adult = ((await t.api("POST", "/profiles", profile())).body as { id: string }).id;
  kid = ((await t.api("POST", "/profiles", profile({ name: "Bé", is_kid: true }))).body as { id: string }).id;
});

describe("ensure: lazy example images and stalled items", () => {
  it("a kid displaying an example draws it once (English translation as scene when there is no prompt)", async () => {
    const id = await oldWord();
    const ex = (await detail(id)).examples[0]!;
    const res = await t.api("POST", `/images/example/${ex.id}/ensure`, { profile_id: kid });
    expect(res.body).toMatchObject({ image_status: "ready", quota: false });
    expect((await t.api("POST", `/images/example/${ex.id}/ensure`, { profile_id: kid })).body).toMatchObject({ image_status: "ready" });
    expect(fake.calls).toHaveLength(1);
  });

  it("an English example without prompt or English translation uses the sentence itself", async () => {
    const res = await t.api("POST", "/words", {
      profile_id: adult, lang: "en", term: `word${++seq}`, reading: "r", pos: "noun", gloss_vi: "v", gloss_en: "e", gloss_ko: "k",
      hanja: null, han_viet: null, emoji: null, ai_generated: false,
      examples: [{ sentence: `I love my family ${seq}.`, translation_vi: "v", translation_en: "", translation_ko: "k", level: "beginner", ai_generated: false }],
    });
    const ex = (await detail((res.body as { id: string }).id)).examples[0]!;
    expect((await t.api("POST", `/images/example/${ex.id}/ensure`, { profile_id: adult })).body).toMatchObject({ image_status: "ready" });
  });

  it("ensure never draws a word or phrase that was simply not requested (only stalled ones)", async () => {
    const id = await oldWord();
    expect((await t.api("POST", `/images/word/${id}/ensure`, { profile_id: adult })).body).toMatchObject({ image_status: "none" });
    expect(fake.calls).toEqual([]);
  });

  it("A: two simultaneous ensure requests → only one wins the claim and calls Workers AI", async () => {
    const id = await oldWord();
    const ex = (await detail(id)).examples[0]!;
    const release = hold();
    const both = Promise.all([
      t.api("POST", `/images/example/${ex.id}/ensure`, { profile_id: adult }),
      t.api("POST", `/images/example/${ex.id}/ensure`, { profile_id: kid }),
    ]);
    await new Promise((r) => setTimeout(r, 50));
    release();
    const [a, b] = await both;
    expect(fake.calls).toHaveLength(1);
    // The loser answers at once with the current state (pending); the winner returns ready.
    expect([a.body, b.body].map((x) => (x as { image_status: string }).image_status).sort()).toEqual(["pending", "ready"]);
  });

  it("a drawing cut off by the 30 s waitUntil limit (pending > 2 min) is taken over; a fresh one is not", async () => {
    const id = await oldWord();
    const now = Date.now();
    await t.env.DB.prepare("UPDATE words SET image_status = 'pending', image_prompt = 'x scene', image_requested_at = ? WHERE id = ?")
      .bind(now - 10_000, id).run();
    expect((await t.api("POST", `/images/word/${id}/ensure`, { profile_id: adult })).body).toMatchObject({ image_status: "pending" });
    expect(fake.calls).toEqual([]);

    await t.env.DB.prepare("UPDATE words SET image_requested_at = ? WHERE id = ?").bind(now - IMAGE_STALE_MS - 1000, id).run();
    expect((await t.api("POST", `/images/word/${id}/ensure`, { profile_id: adult })).body).toMatchObject({ image_status: "ready" });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("backfill (Settings: create images for old words)", () => {
  it("one word per call: prompts from one LLM call, word + phrase drawn, examples stay lazy", async () => {
    const w1 = await oldWord();
    await oldWord();
    expect((await t.api("GET", "/images/backfill/status")).body).toEqual({ remaining: 4 });
    expect((await t.api("POST", "/images/backfill", { profile_id: kid })).status).toBe(403);

    const r = backfillResponseSchema.parse((await t.api("POST", "/images/backfill", { profile_id: adult })).body);
    expect(r).toMatchObject({ word: { id: w1 }, drawn: 2, remaining: 2, quota: false });
    expect(llmRequests).toHaveLength(1);
    const d = await detail(w1);
    expect(d).toMatchObject({ image_status: "ready", image_prompt: `scene for w:${w1}` });
    expect(d.phrases[0]!.image_status).toBe("ready");
    expect(d.examples[0]).toMatchObject({ image_status: "none", image_prompt: `scene for e:${d.examples[0]!.id}` });

    await t.api("POST", "/images/backfill", { profile_id: adult });
    expect(backfillResponseSchema.parse((await t.api("POST", "/images/backfill", { profile_id: adult })).body)).toMatchObject({
      word: null, remaining: 0,
    });
    const llmUse = await t.env.DB.prepare("SELECT count FROM usage_daily WHERE profile_id = ? AND service = 'llm'").bind(adult).first();
    expect(llmUse).toEqual({ count: 2 });
  });

  it("A: two simultaneous backfill calls never draw the same item twice", async () => {
    await oldWord();
    const release = hold();
    const both = Promise.all([
      t.api("POST", "/images/backfill", { profile_id: adult }),
      t.api("POST", "/images/backfill", { profile_id: adult }),
    ]);
    await new Promise((r) => setTimeout(r, 50));
    release();
    const results = (await both).map((r) => backfillResponseSchema.parse(r.body));
    expect(results.reduce((n, r) => n + r.drawn, 0)).toBe(2);
    expect(fake.calls).toHaveLength(2);
  });
});

describe("GET /api/usage", () => {
  it("shows today's image use for the family and the profile, plus LLM and TTS", async () => {
    const id = await oldWord();
    await t.api("POST", "/images/backfill", { profile_id: adult }); // 1 LLM call + word + phrase images
    const ex = (await detail(id)).examples[0]!;
    await t.api("POST", `/images/example/${ex.id}/ensure`, { profile_id: kid }); // 1 image for the kid

    const u = usageSchema.parse((await t.api("GET", `/usage?profile_id=${adult}`)).body);
    expect(u.family).toEqual({ image: 3, image_cap: IMAGE_FAMILY_DAILY_CAP });
    expect(u.profile).toMatchObject({ image: 2, image_limit: IMAGE_DAILY_QUOTA, llm: 1, llm_limit: 50, tts: 0, tts_limit: 200 });
  });

  it("tells which model answered the latest LLM call (primary or fallback)", async () => {
    const llmLast = async () => usageSchema.parse((await t.api("GET", `/usage?profile_id=${adult}`)).body).llm_last;
    const put = (key: string, model: string, at: number) =>
      t.env.DB.prepare("INSERT INTO ai_cache (key, response_json, model, created_at) VALUES (?, '{}', ?, ?)").bind(key, model, at).run();
    const primary = t.env.LLM_MODEL?.trim() || "gemini-3.8-flash";
    await t.env.DB.prepare("DELETE FROM ai_cache").run();

    expect(await llmLast()).toBeNull();
    await put("a", primary, 1_000);
    expect(await llmLast()).toEqual({ model: primary, fallback: false, at: 1_000 });
    await put("b", "some-fallback-model", 2_000);
    expect(await llmLast()).toEqual({ model: "some-fallback-model", fallback: true, at: 2_000 });
    await t.env.DB.prepare("DELETE FROM ai_cache").run();
  });
});
