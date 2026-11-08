import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "./sessionProgress";
import { parseTestMarks, restoreTestMarks, testMarksKey, type SavedTestMarks } from "./testMarks";

const NOW = 1_800_000_000_000;

const marks = (over: Partial<SavedTestMarks> = {}): SavedTestMarks => ({
  v: 1,
  profile_id: "p1",
  test_id: "t1",
  marked: [{ lemma: "가다", gloss_vi: "đi", source: { section: "listening", exam: "35회", number: 21 } }],
  saved_at: NOW - 60_000,
  ...over,
});

describe("testMarksKey", () => {
  it("is per profile", () => {
    expect(testMarksKey("p1")).not.toBe(testMarksKey("p2"));
  });
});

describe("parseTestMarks", () => {
  it("round-trips", () => {
    expect(parseTestMarks(JSON.stringify(marks()))).toEqual(marks());
  });

  it("is null for nothing, rubbish, or another version", () => {
    expect(parseTestMarks(null)).toBeNull();
    expect(parseTestMarks("][")).toBeNull();
    expect(parseTestMarks(JSON.stringify({ ...marks(), v: 2 }))).toBeNull();
  });
});

describe("restoreTestMarks", () => {
  it("restores the marks of this profile's view of this sitting", () => {
    expect(restoreTestMarks(marks(), "p1", "t1", NOW)).toHaveLength(1);
  });

  it("is empty for another profile, another sitting, or nothing saved", () => {
    expect(restoreTestMarks(marks(), "p2", "t1", NOW)).toEqual([]);
    expect(restoreTestMarks(marks(), "p1", "t2", NOW)).toEqual([]);
    expect(restoreTestMarks(null, "p1", "t1", NOW)).toEqual([]);
  });

  it("is empty once the marks are stale — a result reopened days later shows no stray card", () => {
    expect(restoreTestMarks(marks({ saved_at: NOW - SESSION_TTL_MS - 1 }), "p1", "t1", NOW)).toEqual([]);
  });
});
