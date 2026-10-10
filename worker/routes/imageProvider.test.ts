// Which image provider is used: production always the real Workers AI binding, never the fake one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageInfo } from "../lib/imageInfo";
import { createFakeImageAi, FAKE_IMAGE_KEY, FAKE_IMAGE_MODEL, fakePlaceholderBytes } from "../services/fakeImage";
import { IMAGE_KEY_PATTERN } from "../services/imageStore";
import { createTestEnv, testApp } from "../test/testEnv";
import { defaultImageAi } from "./words";

const PROD = "https://lingo.ai4life.workers.dev/api/words";
const LOCAL = "http://localhost:5173/api/words";
const realBinding = { run: async () => ({ image: "x" }) };
const envWith = (ai?: unknown) => ({ AI: ai }) as unknown as Env;

describe("defaultImageAi", () => {
  it("production with the Workers AI binding always uses the real binding", () => {
    expect(defaultImageAi(envWith(realBinding), PROD)).toBe(realBinding);
    expect(defaultImageAi(envWith(realBinding), PROD)?.fake).toBeUndefined();
  });

  it("production without the binding draws nothing: it never falls back to fake images", () => {
    expect(defaultImageAi(envWith(undefined), PROD)).toBeNull();
    expect(defaultImageAi(envWith(undefined), "https://localhost.evil.com/api/words")).toBeNull();
    // Flags that only mean something locally cannot switch the fake provider on elsewhere.
    expect(defaultImageAi({ AI: undefined, DEV_AUTH_BYPASS: "1", DEV_TIME_TRAVEL: "1" } as unknown as Env, PROD)).toBeNull();
  });

  it("local dev without the binding (npm run dev) uses the fake provider; with it (npm run dev:ai) the real one", () => {
    expect(defaultImageAi(envWith(undefined), LOCAL)?.fake).toBe(true);
    expect(defaultImageAi(envWith(realBinding), LOCAL)).toBe(realBinding);
  });
});

describe("fake placeholder", () => {
  it("is a valid 512×512 PNG stored under a key the media route serves", () => {
    expect(imageInfo(fakePlaceholderBytes())).toMatchObject({ ext: "png", width: 512, height: 512 });
    expect(FAKE_IMAGE_KEY).toMatch(IMAGE_KEY_PATTERN);
  });
});

describe("drawing with the fake provider", () => {
  let t: Awaited<ReturnType<typeof createTestEnv>>;
  beforeAll(async () => {
    t = await createTestEnv(testApp({ makeImageAi: () => createFakeImageAi() }));
  }, 60_000);
  afterAll(() => t.dispose());

  it("marks the item ready with model 'fake', stores one shared placeholder and uses no quota", async () => {
    const adult = ((await t.api("POST", "/profiles", {
      name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 5, study_langs: ["ko"],
    })).body as { id: string }).id;
    const ids: string[] = [];
    for (const term of ["사과", "배"]) {
      const res = await t.api("POST", "/words", {
        profile_id: adult, lang: "ko", term, reading: term, pos: "noun", gloss_vi: "v", gloss_en: "e", gloss_ko: "k",
        hanja: null, han_viet: null, emoji: null, ai_generated: false, image_prompt: `a picture of ${term}`, examples: [], phrases: [],
      });
      ids.push((res.body as { id: string }).id);
    }
    await t.settle();
    for (const id of ids) {
      const row = await t.env.DB.prepare("SELECT image_status, image_key, image_model FROM words WHERE id = ?").bind(id).first();
      expect(row).toEqual({ image_status: "ready", image_key: FAKE_IMAGE_KEY, image_model: FAKE_IMAGE_MODEL });
    }
    expect(FAKE_IMAGE_MODEL).toBe("fake");
    expect(await t.env.MEDIA.head(FAKE_IMAGE_KEY)).not.toBeNull();
    const usage = await t.env.DB.prepare("SELECT count(*) AS n FROM usage_daily WHERE service = 'image'").first<{ n: number }>();
    expect(usage?.n).toBe(0);
  });
});
