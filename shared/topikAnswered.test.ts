import { describe, expect, it } from "vitest";
import { historyAsOf, isNewQuestion, splitByFamiliarity, splitReservedForTests } from "./topikAnswered";

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

describe("historyAsOf (M7.30)", () => {
  const e = (at: number, correct: boolean, test_id: string | null = null) => ({ at, correct, test_id });

  it("has nothing to say about a question with no answers", () => {
    expect(historyAsOf([], 100)).toEqual({ attempts: 0, correct: 0 });
    expect(historyAsOf(undefined, 100)).toEqual({ attempts: 0, correct: 0 });
    expect(isNewQuestion(historyAsOf(undefined, 100))).toBe(true);
  });

  it("counts every answer up to the cut-off and how many were right", () => {
    const events = [e(10, true), e(20, false), e(30, true), e(40, false)];
    expect(historyAsOf(events, 100)).toEqual({ attempts: 4, correct: 2 });
  });

  // The whole reason this takes a cut-off: a sitting shows the numbers as they were when it
  // started, so answering question 5 cannot turn "2/4" into "3/5" and give the verdict away.
  it("ignores everything answered after the cut-off", () => {
    const events = [e(10, true), e(20, false), e(500, true)];
    expect(historyAsOf(events, 100)).toEqual({ attempts: 2, correct: 1 });
  });

  it("counts an answer given exactly at the cut-off", () => {
    expect(historyAsOf([e(100, true)], 100)).toEqual({ attempts: 1, correct: 1 });
  });

  // An answer given in the paper being sat is this paper, not history — even in its first second.
  it("leaves the sitting's own answers out", () => {
    const events = [e(10, true), e(100, true, "test-1"), e(100, false, "test-2")];
    expect(historyAsOf(events, 200, "test-1")).toEqual({ attempts: 2, correct: 1 });
  });

  it("is still a seen question when every answer was wrong", () => {
    const history = historyAsOf([e(10, false), e(20, false)], 100);
    expect(history).toEqual({ attempts: 2, correct: 0 });
    expect(isNewQuestion(history)).toBe(false);
  });
});

describe("splitByFamiliarity (M7.30)", () => {
  const item = (attempts: number, is_correct: boolean) => ({ prior: { attempts, correct: 0 }, is_correct });

  it("splits a sitting's score by what the learner had already answered", () => {
    expect(splitByFamiliarity([item(0, true), item(0, false), item(3, true), item(1, true), item(2, false)])).toEqual({
      fresh: { total: 2, correct: 1 },
      seen: { total: 3, correct: 2 },
    });
  });

  it("gives empty halves for a sitting with no questions", () => {
    expect(splitByFamiliarity([])).toEqual({ fresh: { total: 0, correct: 0 }, seen: { total: 0, correct: 0 } });
  });

  it("puts a whole paper of fresh questions on one side", () => {
    expect(splitByFamiliarity([item(0, true), item(0, true)])).toEqual({
      fresh: { total: 2, correct: 2 },
      seen: { total: 0, correct: 0 },
    });
  });
});
