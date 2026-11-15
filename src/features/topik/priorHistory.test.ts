import { describe, expect, it } from "vitest";
import { familiaritySides, priorLabel } from "./priorHistory";

describe("priorLabel (M7.30)", () => {
  it("calls a question nobody has answered new", () => {
    expect(priorLabel({ attempts: 0, correct: 0 })).toEqual({ kind: "new" });
  });

  it("reports the count once there is one, including an all-wrong history", () => {
    expect(priorLabel({ attempts: 4, correct: 2 })).toEqual({ kind: "count", correct: 2, attempts: 4 });
    expect(priorLabel({ attempts: 3, correct: 0 })).toEqual({ kind: "count", correct: 0, attempts: 3 });
  });
});

describe("familiaritySides (M7.30)", () => {
  it("gives both halves of the summary line", () => {
    expect(familiaritySides({ new_questions: { total: 5, correct: 3 }, seen_questions: { total: 10, correct: 8 } })).toEqual([
      { kind: "new", total: 5, correct: 3 },
      { kind: "seen", total: 10, correct: 8 },
    ]);
  });

  it("drops a half with no questions in it rather than saying 0/0", () => {
    expect(familiaritySides({ new_questions: { total: 0, correct: 0 }, seen_questions: { total: 4, correct: 1 } })).toEqual([
      { kind: "seen", total: 4, correct: 1 },
    ]);
    expect(familiaritySides({ new_questions: { total: 4, correct: 1 }, seen_questions: { total: 0, correct: 0 } })).toEqual([
      { kind: "new", total: 4, correct: 1 },
    ]);
  });

  it("says nothing at all about a result with no questions", () => {
    expect(familiaritySides({ new_questions: { total: 0, correct: 0 }, seen_questions: { total: 0, correct: 0 } })).toEqual([]);
  });
});
