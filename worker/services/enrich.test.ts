import { describe, expect, it } from "vitest";
import { sampleEnrichment } from "../test/fakeLlm";
import { enrichCacheKey, finalizeEnrichment } from "./enrich";

describe("finalizeEnrichment", () => {
  it("Korean: keeps Hanja/Hán-Việt and empties the Korean translation of examples", () => {
    const e = finalizeEnrichment("ko", sampleEnrichment);
    expect(e).toMatchObject({ hanja: "學生", han_viet: "học sinh" });
    expect(e.examples.every((ex) => ex.translation_ko === "")).toBe(true);
  });

  it("English: no Hanja / Hán-Việt, empty strings become null", () => {
    const e = finalizeEnrichment("en", { ...sampleEnrichment, emoji: " " });
    expect(e).toMatchObject({ hanja: null, han_viet: null, emoji: null });
    expect(e.examples.every((ex) => ex.translation_en === "")).toBe(true);
  });
});

describe("enrichCacheKey", () => {
  const input = { lang: "ko", term: "학생", level: "beginner" } as const;

  it("is stable and changes with model, term or level", async () => {
    const key = await enrichCacheKey("m1", input);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await enrichCacheKey("m1", input)).toBe(key);
    expect(await enrichCacheKey("m2", input)).not.toBe(key);
    expect(await enrichCacheKey("m1", { ...input, level: "kid" })).not.toBe(key);
    expect(await enrichCacheKey("m1", { ...input, term: "학교" })).not.toBe(key);
  });
});
