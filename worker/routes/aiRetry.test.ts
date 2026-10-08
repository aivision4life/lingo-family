// The enrich API with the real Gemini client against a mock fetch: retries and the fallback
// model cost one quota unit, and ai_cache records which model answered.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProfileCreate } from "../../shared/profile";
import { createLlmClient } from "../services/llm";
import { sampleEnrichment } from "../test/fakeLlm";
import { createTestEnv, testApp } from "../test/testEnv";

let status: Record<string, number> = {};
const calls: string[] = [];
const mockFetch = (async (input: RequestInfo | URL) => {
  const model = /models\/([^:]+):/.exec(String(input))![1]!;
  calls.push(model);
  const s = status[model] ?? 404;
  if (s !== 200) return new Response("{}", { status: s });
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(sampleEnrichment) }] } }] });
}) as typeof fetch;

const llm = createLlmClient(
  { LLM_API_KEY: "test", LLM_MODEL: "main", LLM_FALLBACK_MODEL: "backup" },
  { fetch: mockFetch, sleep: async () => {} },
);

let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult: string;
const profile: ProfileCreate = {
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 10, study_langs: ["ko"],
};
const enrich = (term: string) => t.api("POST", "/words/enrich", { profile_id: adult, lang: "ko", term, level: "beginner" });
const one = async <T>(sql: string) => t.env.DB.prepare(sql).first<T>();

beforeAll(async () => {
  t = await createTestEnv(testApp({ makeLlm: () => llm }));
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["ai_cache", "usage_daily", "profiles"]) await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  calls.length = 0;
  adult = ((await t.api("POST", "/profiles", profile)).body as { id: string }).id;
});

describe("enrich with retries and the fallback model", () => {
  it("busy primary → fallback answers: one quota unit, cache records the fallback model", async () => {
    status = { main: 503, backup: 200 };
    const res = await enrich("학생");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["main", "main", "main", "main", "backup"]);
    expect(await one<{ count: number }>("SELECT count FROM usage_daily WHERE service = 'llm'")).toEqual({ count: 1 });
    expect(await one<{ model: string }>("SELECT model FROM ai_cache")).toEqual({ model: "backup" });

    // The cache key uses the primary model, so the fallback's answer is reused (no call, no quota).
    status = { main: 200 };
    expect((await enrich("학생")).body).toMatchObject({ cached: true });
    expect(calls).toHaveLength(5);
  });

  it("primary recovers after a retry: the primary model is recorded", async () => {
    let n = 0;
    status = new Proxy({} as Record<string, number>, { get: (_, m) => (m === "main" ? (n++ === 0 ? 429 : 200) : 404) });
    expect((await enrich("학교")).status).toBe(200);
    expect(await one<{ model: string }>("SELECT model FROM ai_cache")).toEqual({ model: "main" });
    expect(await one<{ count: number }>("SELECT count FROM usage_daily WHERE service = 'llm'")).toEqual({ count: 1 });
  });

  it("everything busy → 503 ai_unavailable, still one quota unit, nothing cached", async () => {
    status = { main: 503, backup: 503 };
    const res = await enrich("선생님");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "ai_unavailable" });
    expect(await one<{ count: number }>("SELECT count FROM usage_daily WHERE service = 'llm'")).toEqual({ count: 1 });
    expect(await one<{ n: number }>("SELECT count(*) AS n FROM ai_cache")).toEqual({ n: 0 });
  });

  it("a refused request (401) → 502 ai_rejected without retries", async () => {
    status = { main: 401, backup: 200 };
    const res = await enrich("회사");
    expect(res.body).toEqual({ error: "ai_rejected" });
    expect(calls).toEqual(["main"]);
  });
});
