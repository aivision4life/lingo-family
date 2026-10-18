import { describe, expect, it } from "vitest";
import { keyTermRows, truncate } from "./questionPreview";

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("아침에 전화를 드렸다.", 40)).toBe("아침에 전화를 드렸다.");
  });

  it("cuts long text to the limit and adds an ellipsis", () => {
    const text = "가".repeat(50);
    const result = truncate(text, 40);
    expect(result).toBe(`${"가".repeat(40)}…`);
  });

  it("trims trailing whitespace left by the cut before adding the ellipsis", () => {
    const text = `${"가".repeat(39)} ${"나".repeat(10)}`;
    expect(truncate(text, 40)).toBe(`${"가".repeat(39)}…`);
  });

  it("trims surrounding whitespace on short text too", () => {
    expect(truncate("  hi  ", 40)).toBe("hi");
  });
});

describe("keyTermRows", () => {
  const vocab = [
    { lemma: "전화", pos: "noun", gloss_vi: "điện thoại" },
    { lemma: "-느라고", pos: "other", gloss_vi: "vì mải…" },
  ];

  it("joins each key term with its meaning from the question's own vocabulary", () => {
    expect(keyTermRows(["-느라고", "전화"], vocab)).toEqual([
      { lemma: "-느라고", pos: "other", gloss_vi: "vì mải…" },
      { lemma: "전화", pos: "noun", gloss_vi: "điện thoại" },
    ]);
  });

  // The server filters invented lemmas out before saving, so this means the two columns drifted
  // apart (e.g. vocab regenerated, key_terms not) — worth seeing on the review screen, not hiding.
  it("keeps a term that has no vocabulary entry, with an empty meaning", () => {
    expect(keyTermRows(["없는말"], vocab)).toEqual([{ lemma: "없는말", pos: "", gloss_vi: "" }]);
  });

  it("returns nothing when the question has no key terms", () => {
    expect(keyTermRows([], vocab)).toEqual([]);
  });
});
