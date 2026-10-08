import { describe, expect, it } from "vitest";
import { llmEnrichmentSchema } from "../../shared/word";
import { fakeLlm, sampleEnrichment } from "../test/fakeLlm";
import { createLlmClient, generateStructured, LlmError } from "./llm";

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
});
