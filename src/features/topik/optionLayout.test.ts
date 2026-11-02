import { describe, expect, it } from "vitest";
import type { TopikContent } from "@shared/topik";
import { allPictureOptions, pictureOptionState } from "./optionLayout";

const pic = (key: string): TopikContent => ({ text: null, image_key: key });
const txt = (text: string): TopikContent => ({ text, image_key: null });

describe("allPictureOptions", () => {
  it("is true for listening 1-3: four drawings, no text", () => {
    expect(allPictureOptions([pic("a"), pic("b"), pic("c"), pic("d")])).toBe(true);
  });

  it("is false for ordinary text options", () => {
    expect(allPictureOptions([txt("가"), txt("나"), txt("다"), txt("라")])).toBe(false);
  });

  it("is false when one option is text — a mixed set stays in text rows", () => {
    expect(allPictureOptions([pic("a"), pic("b"), txt("다"), pic("d")])).toBe(false);
  });

  it("is false when a picture also carries its own text (an illustrated text option)", () => {
    expect(allPictureOptions([pic("a"), { text: "나", image_key: "b" }, pic("c"), pic("d")])).toBe(false);
  });

  it("treats a blank text beside a picture as no text", () => {
    expect(allPictureOptions([pic("a"), { text: "   ", image_key: "b" }, pic("c"), pic("d")])).toBe(true);
  });

  it("is false for no options at all", () => {
    expect(allPictureOptions([])).toBe(false);
  });
});

/**
 * M6.4 fix. The old suite only asked *which layout* a question gets (`allPictureOptions`); nothing
 * asked what an option looks like after it is chosen. That state does not exist in practice, which
 * grades immediately — only a mock test has "chosen but not graded", and there a picture option
 * rendered exactly like an untouched one. On a phone that reads as "the app ignored my tap".
 */
describe("pictureOptionState", () => {
  it("marks the chosen option while nothing is graded yet — the state practice never has", () => {
    expect(pictureOptionState({ option: 2, selected: 2, correct: null, answered: false })).toBe("chosen");
  });

  it("leaves the others alone during a test", () => {
    expect(pictureOptionState({ option: 3, selected: 2, correct: null, answered: false })).toBe("idle");
  });

  it("shows nothing as chosen before an answer is given", () => {
    expect(pictureOptionState({ option: 1, selected: null, correct: null, answered: false })).toBe("idle");
  });

  it("switches to right/wrong/dimmed once the answer is in", () => {
    const graded = { selected: 2, correct: 4, answered: true };
    expect(pictureOptionState({ option: 4, ...graded })).toBe("correct");
    expect(pictureOptionState({ option: 2, ...graded })).toBe("wrong");
    expect(pictureOptionState({ option: 1, ...graded })).toBe("dimmed");
  });

  it("shows the correct option as correct even when it is the one chosen", () => {
    expect(pictureOptionState({ option: 2, selected: 2, correct: 2, answered: true })).toBe("correct");
  });
});
