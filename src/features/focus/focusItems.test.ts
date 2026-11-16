import { describe, expect, it } from "vitest";
import {
  closeAction,
  exampleItem,
  focusKey,
  indexOfKey,
  itemsFromExamples,
  itemsFromWord,
  orderedTranslations,
  parseFocusKey,
  stepIndex,
  swipeDirection,
  withFocus,
  withoutFocus,
} from "./focusItems";

const image = { image_key: null, image_status: "none" as const, image_prompt: null, image_source: null, image_requested_at: null };
const ex = (id: string, sentence: string, over = {}) => ({
  id, sentence, translation_vi: `vi ${id}`, translation_en: `en ${id}`, translation_ko: "", level: "beginner" as const, ai_generated: false, audio_key: `audio/${id}.mp3`, ...image, ...over,
});
const phrase = (id: string, text: string, examples: ReturnType<typeof ex>[]) => ({
  id, word_id: "w", lang: "ko" as const, text, reading: `r ${id}`, gloss_vi: "v", gloss_en: "e", gloss_ko: "k", emoji: "🍎", audio_key: null,
  ai_generated: false, verified: false, examples, ...image,
});

describe("focus items", () => {
  const word = {
    id: "w",
    lang: "ko" as const,
    term: "회사",
    reading: "hoesa",
    gloss_vi: "công ty",
    gloss_en: "company",
    gloss_ko: "",
    audio_key: "audio/w.mp3",
    emoji: "🏢",
    ...image,
    examples: [ex("e1", "첫째"), ex("e2", "둘째")],
    phrases: [phrase("p1", "회사원", [ex("e3", "셋째")]), phrase("p2", "회사일", [])],
  };

  it("word detail order: the word itself, its examples, then each phrase followed by its example", () => {
    expect(itemsFromWord(word as never).map((i) => i.key)).toEqual(["word:w", "example:e1", "example:e2", "phrase:p1", "example:e3", "phrase:p2"]);
  });

  it("the word itself carries its reading and its glosses (M3.2: it can be practised too)", () => {
    expect(itemsFromWord(word as never)[0]).toMatchObject({
      kind: "word",
      text: "회사",
      reading: "hoesa",
      lang: "ko",
      audio_key: "audio/w.mp3",
    });
    expect(itemsFromWord(word as never)[0]?.translations).toEqual({ vi: "công ty", en: "company", ko: "" });
  });

  it("phrases carry a reading; example sentences have none", () => {
    const items = itemsFromWord(word as never);
    expect(items.find((i) => i.kind === "phrase")?.reading).toBe("r p1");
    expect(items.find((i) => i.kind === "example")?.reading).toBeNull();
  });

  it("review: only the examples of the current card", () => {
    const items = itemsFromExamples([ex("e1", "a"), ex("e2", "b")] as never, "en", null);
    expect(items.map((i) => i.text)).toEqual(["a", "b"]);
    expect(items[0]).toMatchObject({ lang: "en", kind: "example", audio_key: "audio/e1.mp3" });
  });

  it("keys round-trip and bad values are rejected", () => {
    expect(parseFocusKey(focusKey("phrase", "abc-1"))).toEqual({ kind: "phrase", id: "abc-1" });
    expect(parseFocusKey(focusKey("word", "w1"))).toEqual({ kind: "word", id: "w1" });
    for (const bad of [null, "", "sentence:1", "example:", "phrase"]) expect(parseFocusKey(bad), String(bad)).toBeNull();
  });

  it("finds the active index and steps without wrapping", () => {
    const items = [exampleItem(ex("a", "x") as never, "ko"), exampleItem(ex("b", "y") as never, "ko"), exampleItem(ex("c", "z") as never, "ko")];
    expect(indexOfKey(items, "example:b")).toBe(1);
    expect(indexOfKey(items, "example:zz")).toBe(-1);
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(1, 1, 3)).toBe(2);
  });

  it("translations: the gloss language first, empty ones left out", () => {
    const t = { vi: "xin chào", en: "hello", ko: "" };
    expect(orderedTranslations(t, "en").map((x) => x.lang)).toEqual(["en", "vi"]);
    expect(orderedTranslations(t, "vi")[0]).toEqual({ lang: "vi", text: "xin chào" });
  });
});

describe("swipeDirection", () => {
  it("a long horizontal move: left = next, right = previous", () => {
    expect(swipeDirection(-80, 5)).toBe(1);
    expect(swipeDirection(80, -5)).toBe(-1);
  });

  it("short moves and mostly vertical moves (scrolling) are not swipes", () => {
    expect(swipeDirection(30, 0)).toBe(0);
    expect(swipeDirection(-60, 70)).toBe(0);
    expect(swipeDirection(-60, 45)).toBe(0); // dx must clearly beat dy
    expect(swipeDirection(-60, 30)).toBe(1);
  });
});

describe("URL and history", () => {
  it("adds and removes ?focus while keeping the other parameters", () => {
    expect(withFocus("?lang=ko&album=a1", "example:e1")).toBe("?lang=ko&album=a1&focus=example%3Ae1");
    expect(withFocus("", "phrase:p1")).toBe("?focus=phrase%3Ap1");
    expect(withFocus("?focus=example:old&x=1", "phrase:new")).toBe("?focus=phrase%3Anew&x=1");
    expect(withoutFocus("?lang=ko&focus=example%3Ae1")).toBe("?lang=ko");
    expect(withoutFocus("?focus=example%3Ae1")).toBe("");
  });

  it("Back closes a view we opened; a direct ?focus= URL is closed by removing the parameter", () => {
    expect(closeAction({ focusPushed: true })).toBe("back");
    expect(closeAction(null)).toBe("replace");
    expect(closeAction({})).toBe("replace");
    expect(closeAction({ focusPushed: false })).toBe("replace");
  });
});
