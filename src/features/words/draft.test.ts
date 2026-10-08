import { describe, expect, it } from "vitest";
import { draftFromEnrichment, draftToCreateInput, emptyDraft, emptyExample } from "./draft";

const meta = { profileId: "p", lang: "ko", term: "학생", level: "beginner", aiFilled: true } as const;

const enrichment = {
  reading: "haksaeng",
  pos: "noun",
  gloss_vi: "học sinh",
  gloss_en: "student",
  gloss_ko: "학생",
  hanja: "學生",
  han_viet: "học sinh",
  emoji: null,
  examples: [
    { sentence: "저는 학생이에요.", translation_vi: "Tôi là học sinh.", translation_en: "I am a student.", translation_ko: "" },
    { sentence: "학생이 많아요.", translation_vi: "Nhiều học sinh.", translation_en: "Many students.", translation_ko: "" },
  ],
} as const;

describe("word draft", () => {
  it("round-trips an AI enrichment into create input", () => {
    const { input } = draftToCreateInput(draftFromEnrichment({ ...enrichment, examples: [...enrichment.examples], phrases: [] }), meta);
    expect(input).toMatchObject({ term: "학생", ai_generated: true, hanja: "學生", emoji: "" });
    expect(input?.examples).toHaveLength(2);
    expect(input?.examples[0]).toMatchObject({ level: "beginner", ai_generated: true });
  });

  it("drops blank example rows and reports missing required fields", () => {
    const { errors } = draftToCreateInput({ ...emptyDraft(), examples: [emptyExample()] }, meta);
    expect(errors).toMatchObject({ reading: true, gloss_vi: true, gloss_en: true, gloss_ko: true });
    expect(Object.keys(errors ?? {}).some((k) => k.startsWith("examples"))).toBe(false);
  });

  it("ignores Hanja fields for English words", () => {
    const d = draftFromEnrichment({ ...enrichment, examples: [...enrichment.examples], phrases: [] });
    expect(draftToCreateInput(d, { ...meta, lang: "en", term: "student" }).input).toMatchObject({
      hanja: null,
      han_viet: null,
    });
  });
});
