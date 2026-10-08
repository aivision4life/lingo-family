import { describe, expect, it } from "vitest";
import { sampleEnrichment } from "../test/fakeLlm";
import { enrichCacheKey, finalizeEnrichment, finalizePhrases } from "./enrich";
import { buildEnrichPrompt, buildPhrasePrompt, ENRICH_PROMPT_VERSION } from "./enrichPrompt";
import { IMAGE_PROMPT_RULES } from "./imagePrompt";

describe("finalizeEnrichment", () => {
  it("Korean: keeps Hanja/Hán-Việt and empties the Korean translation of examples", () => {
    const e = finalizeEnrichment("ko", "학생", sampleEnrichment);
    expect(e).toMatchObject({ hanja: "學生", han_viet: "học sinh" });
    expect(e.examples.every((ex) => ex.translation_ko === "")).toBe(true);
  });

  it("English: no Hanja / Hán-Việt, empty strings become null", () => {
    const e = finalizeEnrichment("en", "apple", { ...sampleEnrichment, emoji: " " });
    expect(e).toMatchObject({ hanja: null, han_viet: null, emoji: null });
    expect(e.examples.every((ex) => ex.translation_en === "")).toBe(true);
  });
});

describe("finalizePhrases", () => {
  const phrase = sampleEnrichment.phrases[0]!;

  it("keeps 2 word examples and up to 3 phrases, dropping the word itself and duplicates", () => {
    const raw = {
      ...sampleEnrichment,
      examples: [...sampleEnrichment.examples, sampleEnrichment.examples[0]!],
      phrases: [phrase, { ...phrase, text: " 대학생 " }, { ...phrase, text: "학생" }, { ...phrase, text: "학생회" }],
    };
    const e = finalizeEnrichment("ko", "학생", raw);
    expect(e.examples).toHaveLength(2);
    expect(e.phrases.map((p) => p.text)).toEqual(["대학생", "학생회"]);
    expect(e.phrases[0]!.example.translation_ko).toBe("");
  });

  it("is case-insensitive for English", () => {
    const out = finalizePhrases("en", "apple", [
      { ...phrase, text: "Apple" },
      { ...phrase, text: "apple pie" },
      { ...phrase, text: "Apple Pie" },
    ]);
    expect(out.map((p) => p.text)).toEqual(["apple pie"]);
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

describe("image prompts in enrichment (M1.8)", () => {
  it("keeps the image_prompt of the word, its examples, phrases and phrase examples", () => {
    const out = finalizeEnrichment("ko", "학생", sampleEnrichment);
    expect(out.image_prompt).toBe(sampleEnrichment.image_prompt);
    expect(out.examples.every((e) => e.image_prompt.length > 0)).toBe(true);
    expect(out.phrases.map((p) => [p.image_prompt.length > 0, p.example.image_prompt.length > 0])).toEqual([[true, true], [true, true]]);
  });

  it("the prompts ask for image_prompt with the shared rules and a new cache version", () => {
    const { system } = buildEnrichPrompt("ko", "학생", "beginner");
    expect(system).toContain("image_prompt");
    expect(system).toContain(IMAGE_PROMPT_RULES);
    expect(buildPhrasePrompt("ko", "학생", "beginner").system).toContain(IMAGE_PROMPT_RULES);
    expect(ENRICH_PROMPT_VERSION).toBe("enrich-v4");
  });
});
