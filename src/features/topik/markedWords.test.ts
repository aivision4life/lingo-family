import { describe, expect, it } from "vitest";
import { toggleMarked, type MarkedTerm } from "./markedWords";

const source = { section: "reading", exam: "8DeOfficial-35회", number: 12 } as const;
const term = (lemma: string, gloss_vi: string, over: Partial<MarkedTerm> = {}): MarkedTerm => ({ lemma, gloss_vi, source, ...over });

describe("toggleMarked", () => {
  it("adds a lemma that isn't marked yet", () => {
    expect(toggleMarked([], term("일어나다", "thức dậy"))).toEqual([term("일어나다", "thức dậy")]);
  });

  it("removes a lemma that is already marked (un-marking)", () => {
    expect(toggleMarked([term("일어나다", "thức dậy")], term("일어나다", "thức dậy"))).toEqual([]);
  });

  it("keeps other marked terms untouched", () => {
    expect(toggleMarked([term("전화", "điện thoại")], term("일어나다", "thức dậy"))).toEqual([
      term("전화", "điện thoại"),
      term("일어나다", "thức dậy"),
    ]);
  });

  // The album a word joins comes from the question it was met in, so the question travels with it.
  it("keeps the question each term was met in", () => {
    const listening = { section: "listening", exam: "8DeOfficial-36회", number: 21 } as const;
    const marked = toggleMarked([term("전화", "điện thoại")], term("남자", "người đàn ông", { source: listening }));
    expect(marked.map((m) => m.source)).toEqual([source, listening]);
  });

  // Met again in a later question: it is still the same lemma, so the button still un-marks it
  // rather than listing it twice.
  it("un-marks a term met again in another question instead of duplicating it", () => {
    const again = term("전화", "điện thoại", { source: { section: "reading", exam: "8DeOfficial-41회", number: 3 } });
    expect(toggleMarked([term("전화", "điện thoại")], again)).toEqual([]);
  });
});
