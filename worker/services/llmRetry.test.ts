import { describe, expect, it } from "vitest";
import { createLlmClient, LlmError } from "./llm";
import { retryAfterMs } from "./llmRetry";

const KEY = "secret-test-key";
const req = { system: "sys", user: "u", jsonSchema: {} };
const answer = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

type Step = number | "network" | { status: number; retryAfter: string };

/**
 * Mock fetch: each call takes the next step for its model (the last step repeats).
 * A number is an HTTP status (200 answers `ok from <model>`).
 */
function mockGemini(steps: Record<string, Step[]>) {
  const calls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const model = decodeURIComponent(/models\/([^:]+):/.exec(String(input))![1]!);
    const seq = steps[model] ?? [404];
    const step = seq[Math.min(calls.filter((m) => m === model).length, seq.length - 1)]!;
    calls.push(model);
    if (step === "network") throw new TypeError("fetch failed");
    const status = typeof step === "number" ? step : step.status;
    const headers: Record<string, string> = typeof step === "number" ? {} : { "retry-after": step.retryAfter };
    if (status === 200) return Response.json(answer(`ok from ${model}`));
    return new Response(`{"error":{"code":${status}}}`, { status, headers });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** Client with recorded (instant) sleeps; random = 0.5 → no jitter. */
function client(steps: Record<string, Step[]>, fallback?: string, random = 0.5) {
  const mock = mockGemini(steps);
  const sleeps: number[] = [];
  const llm = createLlmClient(
    { LLM_API_KEY: KEY, LLM_MODEL: "main", LLM_FALLBACK_MODEL: fallback },
    { fetch: mock.fetch, sleep: async (ms) => void sleeps.push(ms), random: () => random },
  )!;
  return { llm, calls: mock.calls, sleeps };
}

const fail = (p: Promise<unknown>) => p.then(() => { throw new Error("expected failure"); }, (e: unknown) => e as LlmError);

describe("LLM retry", () => {
  it("retries 503 / 500 / 429 with exponential backoff (1s, 3s, 9s) and returns the answer", async () => {
    const { llm, calls, sleeps } = client({ main: [503, 500, 429, 200] });
    expect(await llm.generate(req)).toEqual({ text: "ok from main", model: "main" });
    expect(calls).toEqual(["main", "main", "main", "main"]);
    expect(sleeps).toEqual([1000, 3000, 9000]);
  });

  it("adds ±25 % jitter to each wait", async () => {
    const low = client({ main: [503, 200] }, undefined, 0);
    await low.llm.generate(req);
    const high = client({ main: [503, 200] }, undefined, 1);
    await high.llm.generate(req);
    expect([low.sleeps[0], high.sleeps[0]]).toEqual([750, 1250]);
  });

  it("retries network errors and honours Retry-After when it is longer", async () => {
    const { llm, sleeps } = client({ main: ["network", { status: 429, retryAfter: "5" }, 200] });
    expect((await llm.generate(req)).model).toBe("main");
    expect(sleeps).toEqual([1000, 5000]);
  });

  it.each([400, 401, 403])("does not retry or fall back on HTTP %i", async (status) => {
    const { llm, calls, sleeps } = client({ main: [status], backup: [200] }, "backup");
    const err = await fail(llm.generate(req));
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe("rejected");
    expect(calls).toEqual(["main"]);
    expect(sleeps).toEqual([]);
  });

  it("gives up after 3 retries without a fallback model: unavailable", async () => {
    const { llm, calls } = client({ main: [503] });
    const err = await fail(llm.generate(req));
    expect(err.code).toBe("unavailable");
    expect(calls).toHaveLength(4);
    expect(err.message).not.toContain(KEY);
  });
});

describe("LLM fallback model", () => {
  it("tries the fallback once after the retries and reports which model answered", async () => {
    const { llm, calls } = client({ main: [503], backup: [200] }, "backup");
    expect(await llm.generate(req)).toEqual({ text: "ok from backup", model: "backup" });
    expect(calls).toEqual(["main", "main", "main", "main", "backup"]);
  });

  it("fails as unavailable when the fallback is busy too (one fallback attempt only)", async () => {
    const { llm, calls } = client({ main: [503], backup: [503] }, "backup");
    expect((await fail(llm.generate(req))).code).toBe("unavailable");
    expect(calls.filter((m) => m === "backup")).toHaveLength(1);
  });

  it("goes straight to the fallback when the primary model id is unknown (404)", async () => {
    const { llm, calls } = client({ main: [404], backup: [200] }, "backup");
    expect((await llm.generate(req)).model).toBe("backup");
    expect(calls).toEqual(["main", "backup"]);
  });

  it("ignores a fallback equal to the primary model", async () => {
    const { llm, calls } = client({ main: [503] }, "main");
    await fail(llm.generate(req));
    expect(calls).toHaveLength(4);
  });
});

describe("retryAfterMs", () => {
  it("parses seconds and HTTP dates", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });
});
