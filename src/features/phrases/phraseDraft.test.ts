import { describe, expect, it } from "vitest";
import { draftFromSuggestion, emptyPhraseDraft, phraseDraftToInput, selectedPhraseInputs } from "./phraseDraft";

const suggestion = {
  text: "대학생",
  reading: "daehaksaeng",
  gloss_vi: "sinh viên",
  gloss_en: "university student",
  gloss_ko: "대학에 다니는 학생",
  image_prompt: "A young adult on a university campus",
  example: {
    sentence: "저는 대학생이에요.", translation_vi: "Tôi là sinh viên.", translation_en: "I am a student.", translation_ko: "",
    image_prompt: "A smiling student holding books",
  },
};

describe("phrase drafts", () => {
  it("AI suggestions start unticked; manual drafts start ticked", () => {
    expect(draftFromSuggestion(suggestion).selected).toBe(false);
    expect(emptyPhraseDraft().selected).toBe(true);
  });

  it("converts a draft with its example", () => {
    const { input } = phraseDraftToInput(draftFromSuggestion(suggestion), "beginner");
    expect(input).toMatchObject({
      text: "대학생",
      ai_generated: true,
      image_prompt: "A young adult on a university campus",
      example: { sentence: "저는 대학생이에요.", level: "beginner", image_prompt: "A smiling student holding books" },
    });
  });

  it("a blank sentence means no example", () => {
    const d = { ...draftFromSuggestion(suggestion), sentence: "  " };
    expect(phraseDraftToInput(d, "beginner").input?.example).toBeNull();
  });

  it("reports missing fields", () => {
    expect(phraseDraftToInput(emptyPhraseDraft(), "beginner").errors).toMatchObject({
      text: true,
      reading: true,
      gloss_vi: true,
    });
  });

  it("only ticked drafts are converted", () => {
    const a = { ...draftFromSuggestion(suggestion), selected: true };
    const b = draftFromSuggestion({ ...suggestion, text: "학생증" });
    const r = selectedPhraseInputs([a, b], "beginner");
    expect(r.ok).toBe(true);
    expect(r.inputs.map((i) => i.text)).toEqual(["대학생"]);
  });
});
