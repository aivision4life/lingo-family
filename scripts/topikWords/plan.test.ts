import { describe, expect, it } from "vitest";
import type { TopikOptions } from "../../shared/topik";
import { estimateCalls, questionVocabText, selectPending, type PendingRow } from "./plan";

const options = (texts: (string | null)[]): TopikOptions =>
  texts.map((text) => ({ text, image_key: text === null ? "k" : null })) as unknown as TopikOptions;

const row = (over: Partial<PendingRow> = {}): PendingRow => ({
  id: "q1",
  exam: "Test/연습1",
  number: 1,
  stem_text: "아침에 (   ) 전화를 드렸다.",
  options: options(["일어나서", "일어나는데", "일어나자마자", "일어나고"]),
  vocab_checked_at: null,
  ...over,
});

describe("questionVocabText", () => {
  it("joins stem and option texts, skipping null/empty ones — never the instruction", () => {
    expect(questionVocabText(row())).toBe("아침에 (   ) 전화를 드렸다.\n일어나서\n일어나는데\n일어나자마자\n일어나고");
  });

  it("is empty for an image-only question", () => {
    const text = questionVocabText(row({ stem_text: null, options: options([null, null, null, null]) }));
    expect(text).toBe("");
  });
});

describe("selectPending", () => {
  it("keeps only rows never checked before by default", () => {
    const rows = [row({ id: "a", vocab_checked_at: null }), row({ id: "b", vocab_checked_at: 123 })];
    expect(selectPending(rows, false).map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps every row when --force is on", () => {
    const rows = [row({ id: "a", vocab_checked_at: null }), row({ id: "b", vocab_checked_at: 123 })];
    expect(selectPending(rows, true).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("estimateCalls", () => {
  it("counts only rows that have something to tokenize", () => {
    const withText = row();
    const imageOnly = row({ id: "b", stem_text: null, options: options([null, null, null, null]) });
    expect(estimateCalls([withText, imageOnly])).toBe(1);
  });
});
