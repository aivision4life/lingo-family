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
    const englishExample = { ...phrase.example, sentence: "I love apple pie.", translation_ko: "" };
    const out = finalizePhrases("en", "apple", [
      { ...phrase, text: "Apple", example: englishExample },
      { ...phrase, text: "apple pie", example: englishExample },
      { ...phrase, text: "Apple Pie", example: englishExample },
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

  // M7.12: the style is only part of the key when it is not the default, so nothing cached before
  // it existed — and no ordinary word since — loses its entry.
  it("leaves an ordinary word's key untouched and gives the TOPIK style its own", async () => {
    const key = await enrichCacheKey("m1", input);
    expect(await enrichCacheKey("m1", { ...input, style: "general" })).toBe(key);
    expect(await enrichCacheKey("m1", { ...input, style: "topik" })).not.toBe(key);
  });
});

describe("the TOPIK example style (M7.12)", () => {
  it("replaces the level rule with the exam's register and subject matter", () => {
    const topik = buildEnrichPrompt("ko", "환경", "beginner", "topik").system;
    const general = buildEnrichPrompt("ko", "환경", "beginner").system;
    expect(topik).toContain("TOPIK II reading passage");
    expect(topik).toContain("society, economy, environment");
    // The level rule and the TOPIK rule are alternatives: a formal exam sentence is not "short and
    // simple, common vocabulary", and having both would ask for two different things at once.
    expect(general).toContain("short and simple");
    expect(topik).not.toContain("short and simple");
  });

  it("changes nothing else about the prompt", () => {
    const topik = buildEnrichPrompt("ko", "환경", "beginner", "topik").system;
    expect(topik).toContain(IMAGE_PROMPT_RULES);
    expect(topik).toContain("hanja");
    // Default argument = the old behaviour, so every other caller is untouched.
    expect(buildEnrichPrompt("ko", "환경", "beginner", "general").system).toBe(buildEnrichPrompt("ko", "환경", "beginner").system);
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
