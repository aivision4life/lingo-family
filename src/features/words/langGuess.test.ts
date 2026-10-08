import { describe, expect, it } from "vitest";
import { guessLangFromScript } from "./langGuess";

describe("guessLangFromScript", () => {
  it.each([
    ["학생", "ko"],
    ["사과나무", "ko"],
    ["학교 學校", "ko"], // Hangul wins over Hanja
    ["family", "en"],
    ["ice cream", "en"],
    ["mother-in-law", "en"],
    ["don't", "en"],
    ["café", "en"],
  ] as const)("%s → %s", (term, lang) => {
    expect(guessLangFromScript(term)).toBe(lang);
  });

  it.each(["", "   ", "123", "😀", "abc123", "學習", "学习"])("%j has no clear guess (Hanja only included)", (term) => {
    expect(guessLangFromScript(term)).toBeNull();
  });
});
