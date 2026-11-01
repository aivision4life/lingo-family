import { describe, expect, it } from "vitest";
import type { TopikContent } from "@shared/topik";
import { allPictureOptions } from "./optionLayout";

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
