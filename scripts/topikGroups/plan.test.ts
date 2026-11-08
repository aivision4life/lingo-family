import { describe, expect, it } from "vitest";
import { groupSummary, planBackfill, stemDrift, type FileGroup, type StoredRow } from "./plan";

const row = (over: Partial<StoredRow> = {}): StoredRow => ({
  id: "q1",
  section: "reading",
  exam: "8DeOfficial-35회",
  number: 19,
  group_key: null,
  stem_text: "passage",
  ...over,
});

const file = (over: Partial<FileGroup> = {}): FileGroup => ({
  section: "reading",
  exam: "8DeOfficial-35회",
  number: 19,
  group_key: "reading|8DeOfficial-35회|19",
  ...over,
});

describe("planBackfill", () => {
  it("changes a row the files give a key to", () => {
    const plan = planBackfill([row()], [file()]);
    expect(plan.changes).toEqual([
      { id: "q1", section: "reading", exam: "8DeOfficial-35회", number: 19, from: null, to: "reading|8DeOfficial-35회|19" },
    ]);
    expect(plan.unchanged).toBe(0);
  });

  it("is a no-op the second time, which is what makes it safe to run twice", () => {
    const stored = [row({ group_key: "reading|8DeOfficial-35회|19" })];
    const plan = planBackfill(stored, [file()]);
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("leaves a lone question's null key alone", () => {
    const plan = planBackfill([row({ number: 5 })], [file({ number: 5, group_key: null })]);
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  // The quiet loss this script must not be capable of: a row whose Word file was renamed or
  // removed keeps the key it has, and is named in the report instead of being cleared.
  it("never clears the key of a row no file covers — it reports it", () => {
    const orphan = row({ id: "q9", number: 44, group_key: "reading|8DeOfficial-35회|44" });
    const plan = planBackfill([orphan], [file()]);
    expect(plan.changes).toEqual([]);
    expect(plan.orphans).toEqual([orphan]);
  });

  it("names a question the files describe but the bank does not have", () => {
    const plan = planBackfill([], [file({ number: 20 })]);
    expect(plan.missing).toEqual([file({ number: 20 })]);
  });

  it("keeps the sections apart: the same number in both is two questions", () => {
    const stored = [row({ id: "r19" }), row({ id: "l19", section: "listening" })];
    const plan = planBackfill(stored, [file()]);
    expect(plan.changes.map((c) => c.id)).toEqual(["r19"]);
    expect(plan.orphans.map((o) => o.id)).toEqual(["l19"]);
  });
});

describe("groupSummary", () => {
  it("lists each group's questions in order, ignoring lone questions", () => {
    const groups = groupSummary([file({ number: 20 }), file({ number: 19 }), file({ number: 5, group_key: null })]);
    expect(groups).toEqual([{ group_key: "reading|8DeOfficial-35회|19", section: "reading", exam: "8DeOfficial-35회", numbers: [19, 20] }]);
  });
});

describe("stemDrift", () => {
  it("reports a group whose members' stored text is not identical", () => {
    const stored = [row({ id: "a", number: 19, stem_text: "passage" }), row({ id: "b", number: 20, stem_text: "passage " })];
    const drift = stemDrift(stored, [file({ number: 19 }), file({ number: 20 })]);
    expect(drift).toEqual([
      {
        group_key: "reading|8DeOfficial-35회|19",
        members: [
          { number: 19, stem_text: "passage" },
          { number: 20, stem_text: "passage " },
        ],
      },
    ]);
  });

  it("says nothing when they agree", () => {
    const stored = [row({ id: "a", number: 19 }), row({ id: "b", number: 20 })];
    expect(stemDrift(stored, [file({ number: 19 }), file({ number: 20 })])).toEqual([]);
  });

  it("ignores questions that share nothing", () => {
    const stored = [row({ id: "a", number: 5, stem_text: "one" }), row({ id: "b", number: 6, stem_text: "two" })];
    const files = [file({ number: 5, group_key: null }), file({ number: 6, group_key: null })];
    expect(stemDrift(stored, files)).toEqual([]);
  });
});
