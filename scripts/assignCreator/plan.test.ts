import { describe, expect, it } from "vitest";
import { countByTable, planAssignCreator, type CreatorRow } from "./plan";

const row = (over: Partial<CreatorRow>): CreatorRow => ({
  table: "words", id: "w1", lang: "ko", term: "학생", created_by_profile: null, created_at: 1, ...over,
});

describe("planAssignCreator", () => {
  it("splits NULL rows (to update) from rows that already have a creator", () => {
    const rows = [row({ id: "w1" }), row({ id: "w2", created_by_profile: "p-old" }), row({ table: "phrases", id: "p1", term: "대학생" })];
    const plan = planAssignCreator(rows);
    expect(plan.toUpdate.map((r) => r.id)).toEqual(["w1", "p1"]);
    expect(plan.alreadySet.map((r) => r.id)).toEqual(["w2"]);
  });

  it("is idempotent: re-planning after an apply (all rows now have a creator) updates nothing", () => {
    const rows = [row({ id: "w1" }), row({ table: "phrases", id: "p1", term: "대학생" })];
    const after = planAssignCreator(rows).toUpdate.map((r) => ({ ...r, created_by_profile: "p-hiep" }));
    const again = planAssignCreator(after);
    expect(again.toUpdate).toEqual([]);
    expect(again.alreadySet).toHaveLength(2);
  });

  it("counts by table", () => {
    const rows = [row({ id: "w1" }), row({ id: "w2" }), row({ table: "phrases", id: "p1", term: "x" })];
    expect(countByTable(planAssignCreator(rows).toUpdate)).toEqual({ words: 2, phrases: 1 });
  });

  it("handles an empty input", () => {
    expect(planAssignCreator([])).toEqual({ toUpdate: [], alreadySet: [] });
  });
});
