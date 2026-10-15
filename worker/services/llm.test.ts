import { describe, expect, it } from "vitest";
import { llmEnrichmentSchema } from "../../shared/word";
import { fakeLlm, sampleEnrichment } from "../test/fakeLlm";
import { afterEach, vi } from "vitest";
import { createLlmClient, describeGeminiError, generateStructured, LlmError } from "./llm";

const prompt = { system: "sys", user: "Word: 학생" };
const valid = JSON.stringify(sampleEnrichment);

describe("generateStructured", () => {
  it("returns parsed output and sends a JSON schema", async () => {
    const { client, requests } = fakeLlm([valid]);
    expect(await generateStructured(client, llmEnrichmentSchema, prompt)).toEqual({ data: sampleEnrichment, model: "fake-model" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.jsonSchema).toMatchObject({ type: "object" });
  });

  it("retries once after invalid JSON", async () => {
    const { client, requests } = fakeLlm(["not json", valid]);
    await expect(generateStructured(client, llmEnrichmentSchema, prompt)).resolves.toMatchObject({ data: sampleEnrichment });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.user).toContain("not valid JSON");
  });

  it("retries once after a schema mismatch, with the problems in the prompt", async () => {
    const { client, requests } = fakeLlm([JSON.stringify({ ...sampleEnrichment, pos: "thing" }), valid]);
    await generateStructured(client, llmEnrichmentSchema, prompt);
    expect(requests[1]!.user).toContain("pos");
  });

  it("fails with invalid_output after two bad answers", async () => {
    const { client, requests } = fakeLlm(["{}"]);
    const err = await generateStructured(client, llmEnrichmentSchema, prompt).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe("invalid_output");
    expect(requests).toHaveLength(2);
  });

  it("retries once after a content problem, with the problems in the prompt", async () => {
    const { client, requests } = fakeLlm([valid, valid]);
    await generateStructured(client, llmEnrichmentSchema, prompt, () => ["gloss_ko: a lone Latin letter \"a\""]);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.user).toContain("content problems");
  });

  it("does not throw when a content problem is still present after the retry — it returns the data for the caller to filter", async () => {
    const { client, requests } = fakeLlm([valid, valid]);
    const result = await generateStructured(client, llmEnrichmentSchema, prompt, () => ["gloss_ko: still bad"]);
    expect(result).toEqual({ data: sampleEnrichment, model: "fake-model" });
    expect(requests).toHaveLength(2);
  });

  it("schema is still checked first: a schema mismatch retries even when validateContent is given", async () => {
    const { client, requests } = fakeLlm([JSON.stringify({ ...sampleEnrichment, pos: "thing" }), valid]);
    const validateContent = vi.fn(() => []);
    await generateStructured(client, llmEnrichmentSchema, prompt, validateContent);
    expect(requests[1]!.user).toContain("pos");
    expect(validateContent).toHaveBeenCalledTimes(1); // only once the schema parsed
  });
});

describe("createLlmClient", () => {
  it("is null without an API key or with an unknown provider", () => {
    expect(createLlmClient({})).toBeNull();
    expect(createLlmClient({ LLM_API_KEY: "k", LLM_PROVIDER: "other" })).toBeNull();
  });

  it("defaults to Gemini and gemini-3.8-flash", () => {
    expect(createLlmClient({ LLM_API_KEY: "k" })?.model).toBe("gemini-3.8-flash");
    expect(createLlmClient({ LLM_API_KEY: "k", LLM_MODEL: "gemini-x" })?.model).toBe("gemini-x");
  });

  it("trims secrets pasted with a trailing newline", () => {
    expect(createLlmClient({ LLM_API_KEY: "k\r\n", LLM_MODEL: " gemini-x \n" })?.model).toBe("gemini-x");
    expect(createLlmClient({ LLM_API_KEY: "  \n" })).toBeNull();
  });
});

describe("describeGeminiError", () => {
  const h = (init: Record<string, string> = {}) => new Headers(init);

  it("uses error.status and error.message of a JSON body", () => {
    const body = JSON.stringify({ error: { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" } });
    expect(describeGeminiError(400, body, h())).toBe("FAILED_PRECONDITION: User location is not supported for the API use.");
  });

  it("falls back to the raw text, then to response headers for an empty body", () => {
    expect(describeGeminiError(400, "<html>Bad</html>", h())).toBe("<html>Bad</html>");
    const empty = describeGeminiError(400, "", h({ "content-type": "text/html", server: "gws", "cf-ray": "abc-ICN" }));
    expect(empty).toBe("(empty body) content-type=text/html server=gws via=- cf-ray=abc-ICN");
  });

  it("is limited to 300 characters and one line", () => {
    const long = describeGeminiError(500, JSON.stringify({ error: { message: `a\n${"x".repeat(1000)}` } }), h());
    expect(long.length).toBe(300);
    expect(long).not.toContain("\n");
  });
});

describe("Gemini HTTP errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the key in x-goog-api-key, never in the URL, and never logs or reports it", async () => {
    const seen: { url: string; key: string | null }[] = [];
    const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), key: new Headers(init?.headers).get("x-goog-api-key") });
      return new Response(JSON.stringify({ error: { message: "bad request", status: "INVALID_ARGUMENT" } }), { status: 400 });
    }) as typeof fetch;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createLlmClient({ LLM_API_KEY: "SECRET-KEY-123" }, { fetch: doFetch })!;

    const err = await client.generate({ system: "s", user: "u", jsonSchema: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).message).toBe("Gemini HTTP 400 (gemini-3.8-flash): INVALID_ARGUMENT: bad request");
    expect(seen[0]!.key).toBe("SECRET-KEY-123");
    expect(seen[0]!.url).not.toContain("SECRET-KEY-123");
    expect(seen[0]!.url).not.toContain("key=");
    expect(JSON.stringify(log.mock.calls)).toContain("INVALID_ARGUMENT: bad request");
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET-KEY-123");
  });
});
