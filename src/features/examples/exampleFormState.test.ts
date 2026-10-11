import { describe, expect, it } from "vitest";
import { applyFields, buildCreate, buildPatch, editNeedsAiStep, emptyForm, formFromExample, showContainsWarning, withSentence } from "./exampleFormState";

const original = { sentence: "저는 학생이에요.", translation_vi: "Tôi là học sinh.", translation_en: "I am a student.", translation_ko: "", image_prompt: "A child at school", ai_generated: true };
const fields = (over = {}) => ({ text: "저는 대학생이에요.", translation_vi: "Tôi là sinh viên.", translation_en: "I am a university student.", translation_ko: "", image_prompt: "A young adult on a campus", ...over });

describe("editing an example", () => {
  it("'Update with AI' turns on by itself when the sentence changes, and off when it is changed back", () => {
    const s0 = formFromExample(original);
    const s1 = withSentence(s0, "저는 대학생이에요.", original.sentence);
    expect(s1.refresh).toBe(true);
    // The user unticks it, then keeps typing: the choice is respected.
    const s2 = withSentence({ ...s1, refresh: false }, "저는 대학생이에요!", original.sentence);
    expect(s2.refresh).toBe(false);
    // Back to the original text: nothing to refresh.
    expect(withSentence(s1, "  저는  학생이에요. ", original.sentence).refresh).toBe(false);
  });

  it("with the box ticked, the first Save runs the AI help; after it the form is saved", () => {
    const changed = withSentence(formFromExample(original), "저는 대학생이에요.", original.sentence);
    expect(editNeedsAiStep(changed, original.sentence)).toBe(true);
    const filled = applyFields(changed, fields());
    expect(filled.ai_generated).toBe(true);
    expect(editNeedsAiStep(filled, original.sentence)).toBe(false);
    // Typing again after the AI ran → it must run again for the new text.
    expect(editNeedsAiStep({ ...filled, sentence: "저는 대학생이에요?" }, original.sentence)).toBe(true);
    // Box unticked, or text unchanged → no AI step.
    expect(editNeedsAiStep({ ...changed, refresh: false }, original.sentence)).toBe(false);
    expect(editNeedsAiStep(formFromExample(original), original.sentence)).toBe(false);
  });

  it("only translations changed → the patch has no sentence, no prompt, no redraw (so no TTS, no drawing)", () => {
    const s = { ...formFromExample(original), translation_vi: "Mình là học sinh." };
    const patch = buildPatch(s, original, "ko", "p1");
    expect(patch).toEqual({ profile_id: "p1", translation_vi: "Mình là học sinh.", translation_en: "I am a student." });
    expect(patch).not.toHaveProperty("sentence");
    expect(patch).not.toHaveProperty("redraw_image");
    expect(patch).not.toHaveProperty("image_prompt");
  });

  it("changed sentence → patch has the sentence (server makes new audio); with the AI refresh it also redraws", () => {
    const base = withSentence(formFromExample(original), "저는 대학생이에요.", original.sentence);
    const plain = buildPatch({ ...base, refresh: false }, original, "ko", "p1");
    expect(plain.sentence).toBe("저는 대학생이에요.");
    expect(plain).not.toHaveProperty("redraw_image");

    const refreshed = buildPatch(applyFields(base, fields()), original, "ko", "p1");
    expect(refreshed).toMatchObject({ sentence: "저는 대학생이에요.", image_prompt: "A young adult on a campus", redraw_image: true, ai_generated: true });
  });

  it("a sentence is never sent with a translation into its own language", () => {
    const en = buildPatch(formFromExample({ ...original, translation_en: "x" }), original, "en", "p1");
    expect(en).not.toHaveProperty("translation_en");
    expect(buildPatch(formFromExample(original), original, "ko", "p1")).not.toHaveProperty("translation_ko");
  });
});

describe("adding an example", () => {
  it("builds the create body: a prompt only when it is long enough, own-language translation empty", () => {
    const s = applyFields(emptyForm(), fields());
    const body = buildCreate({ ...s, translation_ko: "ignored" }, "ko", "p1", null);
    expect(body).toMatchObject({ profile_id: "p1", sentence: "저는 대학생이에요.", translation_ko: "", image_prompt: "A young adult on a campus", ai_generated: true, phrase_id: null });
    expect(buildCreate({ ...emptyForm(), sentence: "문장", image_prompt: "short" }, "ko", "p1", "ph1")).toMatchObject({ image_prompt: null, ai_generated: false, phrase_id: "ph1" });
  });
});

describe("showContainsWarning", () => {
  it("only when the AI says the root word is missing and the text does not contain it literally", () => {
    expect(showContainsWarning("저는 대학생이에요.", "학생", false)).toBe(false); // contains it literally
    expect(showContainsWarning("저는 선생님이에요.", "학생", false)).toBe(true);
    expect(showContainsWarning("저는 선생님이에요.", "학생", true)).toBe(false); // AI: an inflected form is there
    expect(showContainsWarning("저는 선생님이에요.", "학생", null)).toBe(false); // AI not run yet: no warning
    expect(showContainsWarning("x", "", false)).toBe(false);
  });
});
