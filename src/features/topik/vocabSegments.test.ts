import { describe, expect, it } from "vitest";
import type { TopikVocabEntry } from "@shared/topik";
import { isGrammarEntry, segmentText } from "./vocabSegments";

const entry = (over: Partial<TopikVocabEntry> = {}): TopikVocabEntry => ({
  surface: "일어나서",
  lemma: "일어나다",
  pos: "verb",
  gloss_vi: "thức dậy rồi",
  ...over,
});

describe("segmentText", () => {
  it("returns [] for empty text", () => {
    expect(segmentText("", [])).toEqual([]);
  });

  it("returns the whole text as one plain segment when there is no vocab", () => {
    expect(segmentText("아침에 전화를 드렸다.", [])).toEqual([{ text: "아침에 전화를 드렸다.", entry: null }]);
  });

  it("splits an attached grammar ending from its stem without a space (학교 + 에서)", () => {
    const schoolEntry = entry({ surface: "학교", lemma: "학교", pos: "noun", gloss_vi: "trường học" });
    const result = segmentText("학교에서 공부해요.", [schoolEntry]);
    expect(result).toEqual([
      { text: "학교", entry: schoolEntry },
      { text: "에서 공부해요.", entry: null },
    ]);
  });

  it("matches the longest candidate first so a shorter overlapping surface never wins", () => {
    const short = entry({ surface: "일어나", lemma: "일어나다", gloss_vi: "dậy (ngắn)" });
    const long = entry({ surface: "일어나서", lemma: "일어나다", gloss_vi: "thức dậy rồi" });
    const result = segmentText("일어나서 세수했다.", [short, long]);
    expect(result[0]).toEqual({ text: "일어나서", entry: long });
  });

  it("leaves a basic particle untappable (no vocab entry covers it)", () => {
    const nounEntry = entry({ surface: "전화", lemma: "전화", pos: "noun", gloss_vi: "điện thoại" });
    const result = segmentText("전화를 드렸다.", [nounEntry]);
    expect(result).toEqual([
      { text: "전화", entry: nounEntry },
      { text: "를 드렸다.", entry: null },
    ]);
  });

  it("merges consecutive plain stretches around multiple tappable words", () => {
    const a = entry({ surface: "아침", lemma: "아침", pos: "noun", gloss_vi: "buổi sáng" });
    const b = entry({ surface: "전화", lemma: "전화", pos: "noun", gloss_vi: "điện thoại" });
    const result = segmentText("아침에 전화를 드렸다.", [a, b]);
    expect(result).toEqual([
      { text: "아침", entry: a },
      { text: "에 ", entry: null },
      { text: "전화", entry: b },
      { text: "를 드렸다.", entry: null },
    ]);
  });

  it("keeps only the first entry when the same surface form is listed twice", () => {
    const first = entry({ surface: "전화", gloss_vi: "điện thoại (1)" });
    const second = entry({ surface: "전화", gloss_vi: "điện thoại (2)" });
    const result = segmentText("전화", [first, second]);
    expect(result).toEqual([{ text: "전화", entry: first }]);
  });
});

describe("isGrammarEntry", () => {
  it("is true for a grammar ending/particle (pos 'other' or 'particle') — not real library vocabulary", () => {
    expect(isGrammarEntry("other")).toBe(true);
    expect(isGrammarEntry("particle")).toBe(true);
  });

  it("is false for a content word (noun, verb, adjective, adverb, pronoun, numeral, ...)", () => {
    expect(isGrammarEntry("noun")).toBe(false);
    expect(isGrammarEntry("verb")).toBe(false);
    expect(isGrammarEntry("adjective")).toBe(false);
    expect(isGrammarEntry("adverb")).toBe(false);
    expect(isGrammarEntry("pronoun")).toBe(false);
    expect(isGrammarEntry("numeral")).toBe(false);
    expect(isGrammarEntry("conjunction")).toBe(false);
    expect(isGrammarEntry("interjection")).toBe(false);
  });
});
