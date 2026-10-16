import { describe, expect, it } from "vitest";
import type { TopikOptions, TopikVocabEntry } from "../../shared/topik";
import { estimateCalls, questionHasContent, selectPending, type PendingRow } from "./plan";

const options = (texts: (string | null)[]): TopikOptions =>
  texts.map((text) => ({ text, image_key: text === null ? "k" : null })) as unknown as TopikOptions;

const vocab: TopikVocabEntry[] = [{ surface: "일어나서", lemma: "일어나다", pos: "verb", gloss_vi: "thức dậy" }];

const row = (over: Partial<PendingRow> = {}): PendingRow => ({
  id: "q1",
  exam: "Test/연습1",
  number: 1,
  instruction: "가장 알맞은 것을 고르십시오.",
  stem_text: "아침에 (   ) 전화를 드렸다.",
  stem_image_key: null,
  options: options(["일어나서", "일어나는데", "일어나자마자", "일어나고"]),
  correct_option: 1,
  vocab,
  explain_checked_at: null,
  ...over,
});

describe("questionHasContent", () => {
  it("is true when instruction/stem/options have any text", () => {
    expect(questionHasContent(row())).toBe(true);
  });

  it("is false for a fully image-only question", () => {
    const empty = row({ instruction: null, stem_text: null, options: options([null, null, null, null]) });
    expect(questionHasContent(empty)).toBe(false);
  });
});

describe("selectPending", () => {
  it("keeps only rows never checked before by default", () => {
    const rows = [row({ id: "a", explain_checked_at: null }), row({ id: "b", explain_checked_at: 123 })];
    expect(selectPending(rows, false).map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps every row when --force is on", () => {
    const rows = [row({ id: "a", explain_checked_at: null }), row({ id: "b", explain_checked_at: 123 })];
    expect(selectPending(rows, true).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("estimateCalls", () => {
  it("counts only rows that have something to explain", () => {
    const withText = row();
    const imageOnly = row({ id: "b", instruction: null, stem_text: null, options: options([null, null, null, null]) });
    expect(estimateCalls([withText, imageOnly])).toBe(1);
  });
});
