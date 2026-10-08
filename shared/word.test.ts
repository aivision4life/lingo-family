import { describe, expect, it } from "vitest";
import { duplicateKey, enrichRequestSchema, normalizeTerm, wordCreateSchema } from "./word";

describe("term normalization", () => {
  it("trims, collapses spaces and applies NFC", () => {
    // "학" written as decomposed jamo (NFD) must equal the composed syllable.
    expect(normalizeTerm("  ice   cream ")).toBe("ice cream");
    expect(normalizeTerm("학생".normalize("NFD"))).toBe("학생");
  });

  it("makes English duplicates case-insensitive only", () => {
    expect(duplicateKey("en", " Apple ")).toBe("apple");
    expect(duplicateKey("ko", "학생")).toBe("학생");
  });

  it("rejects empty or too long terms", () => {
    const base = { profile_id: "p", lang: "ko", level: "beginner" };
    expect(enrichRequestSchema.safeParse({ ...base, term: "   " }).success).toBe(false);
    expect(enrichRequestSchema.safeParse({ ...base, term: "가".repeat(61) }).success).toBe(false);
  });
});

describe("wordCreateSchema", () => {
  it("turns blank optional fields into null", () => {
    const parsed = wordCreateSchema.parse({
      profile_id: "p",
      lang: "en",
      term: "apple",
      reading: "/ˈæp.əl/",
      pos: "noun",
      gloss_vi: "quả táo",
      gloss_en: "a round fruit",
      gloss_ko: "사과",
      hanja: " ",
      han_viet: "",
      emoji: "🍎",
      ai_generated: true,
      examples: [],
    });
    expect(parsed).toMatchObject({ hanja: null, han_viet: null, emoji: "🍎" });
  });
});
