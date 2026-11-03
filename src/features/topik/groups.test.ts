import { describe, expect, it } from "vitest";
import { groupIndexOf, groupNumbers, groupQuestions, questionsBefore } from "./groups";

const q = (id: string, group_id: string, number: number) => ({ id, group_id, number });

describe("groupQuestions", () => {
  it("puts the two questions about one recording on one screen", () => {
    const groups = groupQuestions([q("a", "clip1", 21), q("b", "clip1", 22), q("c", "clip2", 23)]);
    expect(groups.map((g) => g.questions.map((x) => x.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("gives a question with no clip a screen of its own", () => {
    // A reading question's group is its own id, so each one is a group of one.
    const groups = groupQuestions([q("a", "a", 1), q("b", "b", 2)]);
    expect(groups).toHaveLength(2);
  });

  it("keeps the order the session gave them in", () => {
    const groups = groupQuestions([q("c", "clip2", 23), q("a", "clip1", 21), q("b", "clip1", 22)]);
    expect(groups.map((g) => g.group_id)).toEqual(["clip2", "clip1"]);
  });

  it("does not merge two runs of the same clip that are not next to each other", () => {
    // Cannot happen in a session (a group is drawn whole), but merging far-apart questions would
    // silently reorder the paper, so the function stays local rather than clever.
    const groups = groupQuestions([q("a", "clip1", 21), q("c", "clip2", 23), q("b", "clip1", 22)]);
    expect(groups).toHaveLength(3);
  });

  it("is empty for an empty session", () => {
    expect(groupQuestions([])).toEqual([]);
  });
});

describe("the rest", () => {
  const groups = groupQuestions([q("a", "clip1", 21), q("b", "clip1", 22), q("c", "clip2", 23)]);

  it("finds the screen a question is on", () => {
    expect(groupIndexOf(groups, "b")).toBe(0);
    expect(groupIndexOf(groups, "c")).toBe(1);
    expect(groupIndexOf(groups, "nope")).toBe(-1);
  });

  it("labels a pair by its range and a single by its number", () => {
    expect(groupNumbers(groups[0]!)).toEqual({ from: 21, to: 22 });
    expect(groupNumbers(groups[1]!)).toEqual({ from: 23, to: 23 });
  });

  it("counts questions before a screen, not screens", () => {
    expect([questionsBefore(groups, 0), questionsBefore(groups, 1), questionsBefore(groups, 2)]).toEqual([0, 2, 3]);
  });
});
