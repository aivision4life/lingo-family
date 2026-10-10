// TODO(M2.1): delete with worker/routes/debugLlm.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult: string;
let kid: string;
const SECRET = "AIza-SECRET-KEY-VALUE";

const profile = (name: string, is_kid: boolean) => ({
  name, avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid, daily_new_limit: 5, study_langs: ["ko"],
});

beforeAll(async () => {
  t = await createTestEnv(undefined, { LLM_API_KEY: ` ${SECRET}\n`, LLM_MODEL: "gemini-x\n" });
  adult = ((await t.api("POST", "/profiles", profile("Bố", false))).body as { id: string }).id;
  kid = ((await t.api("POST", "/profiles", profile("Bé", true))).body as { id: string }).id;
}, 60_000);
afterAll(() => t.dispose());
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/debug/llm", () => {
  it("asks for profile_id and lists adult profiles; kids are refused", async () => {
    const missing = await t.api("GET", "/debug/llm");
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain(adult);
    expect(JSON.stringify(missing.body)).not.toContain(kid);
    expect((await t.api("GET", `/debug/llm?profile_id=${kid}`)).status).toBe(403);
  });

  it("reports probes, key shape and exceptions without ever returning the key", async () => {
    const calls: { url: string; key: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), key: new Headers(init.headers).get("x-goog-api-key") });
      if (String(url).endsWith("/models")) return new Response("", { status: 400, headers: { "x-test": "1" } });
      throw new TypeError("Invalid header value");
    });
    const res = await t.api("GET", `/debug/llm?profile_id=${adult}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.key).toMatchObject({ raw_length: SECRET.length + 2, trimmed_length: SECRET.length, has_non_printable_ascii: true, has_non_printable_ascii_after_trim: false });
    expect(body.model).toMatchObject({ trimmed: "gemini-x" });
    expect(body.list_models).toMatchObject({ status: 400, headers: { "x-test": "1" }, body: "" });
    expect(body.generate_content).toEqual({ exception: { name: "TypeError", message: "Invalid header value" } });
    expect(calls.map((c) => c.key)).toEqual([SECRET, SECRET]);
    expect(calls.every((c) => !c.url.includes(SECRET))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});
