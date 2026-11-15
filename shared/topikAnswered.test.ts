import { describe, expect, it } from "vitest";
import { splitReservedForTests } from "./topikAnswered";

/** A question of its own; `pair` gives two that share one passage. */
const q = (id: string) => ({ id, segment_id: null, group_key: null });
const pair = (ids: [string, string], key: string) => ids.map((id) => ({ id, segment_id: null, group_key: key }));
const clipPair = (ids: [string, string], segment: string) => ids.map((id) => ({ id, segment_id: segment, group_key: null }));

describe("splitReservedForTests (M7.27)", () => {
  it("serves what has been answered and keeps the rest", () => {
    const { served, reserved } = splitReservedForTests([q("a"), q("b"), q("c")], new Set(["a", "c"]));
    expect(served.map((x) => x.id)).toEqual(["a", "c"]);
    expect(reserved.map((x) => x.id)).toEqual(["b"]);
  });

  it("keeps nothing back once everything has been answered", () => {
    expect(splitReservedForTests([q("a")], new Set(["a"])).reserved).toEqual([]);
  });

  it("keeps everything back when nothing has been answered", () => {
    expect(splitReservedForTests([q("a"), q("b")], new Set()).served).toEqual([]);
  });

  // The rule that cannot be got wrong: a pair is one screen, and answering half of what a passage
  // or a recording asks is the waste this project already refused once (M7.5).
  it("brings a whole passage pair in when one of its questions has been answered", () => {
    const { served, reserved } = splitReservedForTests(pair(["p19", "p20"], "reading|35회|19"), new Set(["p19"]));
    expect(served.map((x) => x.id)).toEqual(["p19", "p20"]);
    expect(reserved).toEqual([]);
  });

  it("does the same for a pair sharing one recording", () => {
    const { served } = splitReservedForTests(clipPair(["q21", "q22"], "seg-1"), new Set(["q22"]));
    expect(served.map((x) => x.id)).toEqual(["q21", "q22"]);
  });

  it("keeps a pair whole on the other side too: neither half answered, neither served", () => {
    const { served, reserved } = splitReservedForTests(pair(["p19", "p20"], "reading|35회|19"), new Set(["elsewhere"]));
    expect(served).toEqual([]);
    expect(reserved.map((x) => x.id)).toEqual(["p19", "p20"]);
  });

  // Two papers' pairs are different groups even at the same question numbers, because the group id
  // carries the paper (`group_key`) or the clip (`segment_id`).
  it("does not let one paper's answered pair pull another paper's in", () => {
    const questions = [...pair(["a19", "a20"], "reading|35회|19"), ...pair(["b19", "b20"], "reading|36회|19")];
    const { served, reserved } = splitReservedForTests(questions, new Set(["a19"]));
    expect(served.map((x) => x.id)).toEqual(["a19", "a20"]);
    expect(reserved.map((x) => x.id)).toEqual(["b19", "b20"]);
  });

  it("has nothing to say about an empty list", () => {
    expect(splitReservedForTests([], new Set(["a"]))).toEqual({ served: [], reserved: [] });
  });
});
