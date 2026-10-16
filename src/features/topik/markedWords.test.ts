import { describe, expect, it } from "vitest";
import { toggleMarked } from "./markedWords";

describe("toggleMarked", () => {
  it("adds a lemma that isn't marked yet", () => {
    expect(toggleMarked([], "일어나다", "thức dậy")).toEqual([{ lemma: "일어나다", gloss_vi: "thức dậy" }]);
  });

  it("removes a lemma that is already marked (un-marking)", () => {
    const marked = [{ lemma: "일어나다", gloss_vi: "thức dậy" }];
    expect(toggleMarked(marked, "일어나다", "thức dậy")).toEqual([]);
  });

  it("keeps other marked terms untouched", () => {
    const marked = [{ lemma: "전화", gloss_vi: "điện thoại" }];
    expect(toggleMarked(marked, "일어나다", "thức dậy")).toEqual([
      { lemma: "전화", gloss_vi: "điện thoại" },
      { lemma: "일어나다", gloss_vi: "thức dậy" },
    ]);
  });
});
