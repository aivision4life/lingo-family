import { beforeEach, describe, expect, it } from "vitest";
import { createLlmClient, LlmError } from "./llm";
import { MODEL_EXHAUSTED_MS, resetModelExhausted, retryAfterMs } from "./llmRetry";

// "The primary is out of quota" is remembered at module scope: no test may inherit it.
beforeEach(() => resetModelExhausted());

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

/** Client with recorded (instant) sleeps; random = 0.5 → no jitter. `clock.now` is the time it sees. */
function client(steps: Record<string, Step[]>, fallback?: string, random = 0.5) {
  const mock = mockGemini(steps);
  const sleeps: number[] = [];
  const clock = { now: 1_000_000 };
  const llm = createLlmClient(
    { LLM_API_KEY: KEY, LLM_MODEL: "main", LLM_FALLBACK_MODEL: fallback },
    { fetch: mock.fetch, sleep: async (ms) => void sleeps.push(ms), random: () => random, now: () => clock.now },
  )!;
  return { llm, calls: mock.calls, sleeps, clock };
}

const fail = (p: Promise<unknown>) => p.then(() => { throw new Error("expected failure"); }, (e: unknown) => e as LlmError);

describe("LLM retry", () => {
  it("retries 500 with exponential backoff (1s, 3s, 9s) and returns the answer", async () => {
    const { llm, calls, sleeps } = client({ main: [500, 500, 500, 200] });
    expect(await llm.generate(req)).toEqual({ text: "ok from main", model: "main" });
    expect(calls).toEqual(["main", "main", "main", "main"]);
    expect(sleeps).toEqual([1000, 3000, 9000]);
  });

  it("adds ±25 % jitter to each wait", async () => {
    const low = client({ main: [500, 200] }, undefined, 0);
    await low.llm.generate(req);
    const high = client({ main: [500, 200] }, undefined, 1);
    await high.llm.generate(req);
    expect([low.sleeps[0], high.sleeps[0]]).toEqual([750, 1250]);
  });

  it("retries network errors and honours Retry-After when it is longer", async () => {
    const { llm, sleeps } = client({ main: ["network", { status: 500, retryAfter: "5" }, 200] });
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
    const { llm, calls } = client({ main: [500] });
    const err = await fail(llm.generate(req));
    expect(err.code).toBe("unavailable");
    expect(calls).toHaveLength(4);
    expect(err.message).not.toContain(KEY);
  });
});

describe("LLM fallback model", () => {
  it("tries the fallback once after the retries and reports which model answered", async () => {
    const { llm, calls } = client({ main: [500], backup: [200] }, "backup");
    expect(await llm.generate(req)).toEqual({ text: "ok from backup", model: "backup" });
    expect(calls).toEqual(["main", "main", "main", "main", "backup"]);
  });

  it("fails as unavailable when the fallback is busy too (one fallback attempt only)", async () => {
    const { llm, calls } = client({ main: [500], backup: [500] }, "backup");
    expect((await fail(llm.generate(req))).code).toBe("unavailable");
    expect(calls.filter((m) => m === "backup")).toHaveLength(1);
  });

  it("goes straight to the fallback when the primary model id is unknown (404)", async () => {
    const { llm, calls } = client({ main: [404], backup: [200] }, "backup");
    expect((await llm.generate(req)).model).toBe("backup");
    expect(calls).toEqual(["main", "backup"]);
  });

  it("ignores a fallback equal to the primary model", async () => {
    const { llm, calls } = client({ main: [500] }, "main");
    await fail(llm.generate(req));
    expect(calls).toHaveLength(4);
  });
});

// 429 = out of quota, 503 = out of capacity ("this model is currently experiencing high demand").
// Asking the same model again a few seconds later cannot help either way; production paid four
// calls and ~13 s for every result that way (2026-11-15: 31 calls, 31 answers of 429; 2026-11-19:
// the primary answers 503 instead, and had produced 1 of 256 cached results since 2026-11-15).
describe.each([429, 503])("the primary has nothing for us (HTTP %i)", (status) => {
  it("goes straight to the fallback: no retry of the primary, no wait", async () => {
    const { llm, calls, sleeps } = client({ main: [status], backup: [200] }, "backup");
    expect(await llm.generate(req)).toEqual({ text: "ok from backup", model: "backup" });
    expect(calls).toEqual(["main", "backup"]);
    expect(sleeps).toEqual([]);
  });

  it("stops retrying as soon as a retry is answered that way", async () => {
    const { llm, calls, sleeps } = client({ main: [500, status], backup: [200] }, "backup");
    expect((await llm.generate(req)).model).toBe("backup");
    expect(calls).toEqual(["main", "main", "backup"]);
    expect(sleeps).toEqual([1000]);
  });

  it("leaves the primary alone for 10 minutes, then asks it again", async () => {
    const { llm, calls, clock } = client({ main: [status, 200], backup: [200] }, "backup");
    await llm.generate(req);
    expect(calls).toEqual(["main", "backup"]);

    clock.now += MODEL_EXHAUSTED_MS - 1;
    expect((await llm.generate(req)).model).toBe("backup");
    expect(calls).toEqual(["main", "backup", "backup"]); // the primary was not even asked

    clock.now += 1;
    expect((await llm.generate(req)).model).toBe("main");
    expect(calls).toEqual(["main", "backup", "backup", "main"]);
  });

  it("reports the fallback's own failure while the primary is being skipped", async () => {
    const { llm, calls } = client({ main: [status], backup: [200, 500] }, "backup");
    await llm.generate(req);
    const err = await fail(llm.generate(req));
    expect(err.code).toBe("unavailable");
    expect(err.message).toContain("backup");
    expect(calls).toEqual(["main", "backup", "backup"]);
  });

  it("without a fallback it fails at once as unavailable, and the primary is still asked next time", async () => {
    const { llm, calls, sleeps } = client({ main: [status] });
    expect((await fail(llm.generate(req))).code).toBe("unavailable");
    expect(calls).toEqual(["main"]);
    expect(sleeps).toEqual([]);
    await fail(llm.generate(req));
    expect(calls).toEqual(["main", "main"]); // nothing to skip to, so nothing is skipped
  });

  it("the flag can be cleared (tests), and belongs to one model", async () => {
    const first = client({ main: [status, 200], backup: [200] }, "backup");
    await first.llm.generate(req);
    resetModelExhausted();
    expect((await first.llm.generate(req)).model).toBe("main");
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
