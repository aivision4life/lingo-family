import { describe, expect, it } from "vitest";
import { emptySelection, prune, selectAll, selectionLang, toggle } from "./selection";

describe("selection", () => {
  it("toggles ids without mutating the previous selection", () => {
    const one = toggle(emptySelection, "a");
    expect([...one]).toEqual(["a"]);
    expect(emptySelection.size).toBe(0);
    expect(toggle(one, "a").size).toBe(0);
    expect([...toggle(one, "b")]).toEqual(["a", "b"]);
  });

  it("select all and prune to the words still shown", () => {
    const all = selectAll(["a", "b", "c"]);
    expect([...prune(all, ["b", "c", "d"])].sort()).toEqual(["b", "c"]);
    expect(prune(all, ["a", "b", "c"])).toBe(all); // unchanged: same object, no re-render
  });

  it("the language of a selection, or null when it mixes languages or is empty", () => {
    const words = [
      { id: "a", lang: "ko" },
      { id: "b", lang: "ko" },
      { id: "c", lang: "en" },
    ];
    expect(selectionLang(selectAll(["a", "b"]), words)).toBe("ko");
    expect(selectionLang(selectAll(["a", "c"]), words)).toBeNull();
    expect(selectionLang(emptySelection, words)).toBeNull();
  });
});
