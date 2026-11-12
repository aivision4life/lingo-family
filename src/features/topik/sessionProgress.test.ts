import { describe, expect, it } from "vitest";
import type { TopikAttemptResult, TopikPracticeQuestion } from "@shared/topik";
import {
  parseSaved,
  restoreSession,
  SESSION_TTL_MS,
  savedSessionSchema,
  sessionKey,
  trimForQuota,
  type SavedSession,
  type SessionIdentity,
} from "./sessionProgress";
import type { SessionStates } from "./sessionState";

const content = (text: string) => ({ text, image_key: null });

const question = (id: string, number: number, group_id = id): TopikPracticeQuestion => ({
  section: "listening",
  exam: "OfficialTest-35회",
  counts_toward_schedule: true,
  number,
  block: "21~22",
  instruction: null,
  stem: content("질문"),
  options: [content("1"), content("2"), content("3"), content("4")],
  points: 2,
  id,
  vocab: [],
  vocab_ready: true,
  audio: null,
  group_id,
});

const result: TopikAttemptResult = {
  is_correct: true,
  correct_option: 1,
  explanation_vi: null,
  key_terms: [],
  explain_ready: true,
  transcript: null,
  vocab: [],
  group_reveal: [],
};

const identity: SessionIdentity = { profileId: "p1", section: "listening", from: 21, to: 22, mode: "due" };

const NOW = 1_800_000_000_000;

const record = (over: Partial<SavedSession> = {}): SavedSession => ({
  v: 1,
  profile_id: "p1",
  section: "listening",
  from: 21,
  to: 22,
  mode: "due",
  questions: [question("a", 21, "clip1"), question("b", 22, "clip1")],
  index: 0,
  states: {},
  marked: [],
  saved_at: NOW - 60_000,
  ...over,
});

const answered: SessionStates = { a: { kind: "answered", selected: 1, result } };

describe("sessionKey", () => {
  it("is per profile, so one profile never sees another's progress", () => {
    expect(sessionKey("p1")).not.toBe(sessionKey("p2"));
  });
});

describe("parseSaved", () => {
  it("round-trips a record through JSON", () => {
    const r = record({ states: answered, marked: [{ lemma: "가다", gloss_vi: "đi", source: { section: "listening", exam: "e", number: 21 } }] });
    expect(parseSaved(JSON.stringify(r))).toEqual(r);
  });

  it("is null for nothing stored, for rubbish, and for a record of another version", () => {
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved("")).toBeNull();
    expect(parseSaved("{not json")).toBeNull();
    expect(parseSaved(JSON.stringify({ ...record(), v: 2 }))).toBeNull();
  });

  it("is null for a record whose questions no longer parse", () => {
    // An older build's shape, or a question field that has since changed: better a new session
    // than a half-understood one.
    const broken = { ...record(), questions: [{ id: "a" }] };
    expect(parseSaved(JSON.stringify(broken))).toBeNull();
  });

  it("is null for a record with no questions at all", () => {
    expect(savedSessionSchema.safeParse({ ...record(), questions: [] }).success).toBe(false);
  });
});

describe("restoreSession", () => {
  const ids = ["a", "b"];

  it("restores a session whose questions the server still serves", () => {
    expect(restoreSession(record(), identity, ids, NOW)).not.toBeNull();
  });

  it("is null when there is nothing saved", () => {
    expect(restoreSession(null, identity, ids, NOW)).toBeNull();
  });

  it("refuses another profile's record", () => {
    expect(restoreSession(record({ profile_id: "p2" }), identity, ids, NOW)).toBeNull();
  });

  it("refuses a record from another block, section or mode", () => {
    expect(restoreSession(record({ from: 23 }), identity, ids, NOW)).toBeNull();
    expect(restoreSession(record({ to: 30 }), identity, ids, NOW)).toBeNull();
    expect(restoreSession(record({ section: "reading" }), identity, ids, NOW)).toBeNull();
    // Practising ahead of the schedule is a different session even over the same questions.
    expect(restoreSession(record({ mode: "all" }), identity, ids, NOW)).toBeNull();
  });

  it("drops a record older than the time to live", () => {
    expect(restoreSession(record({ saved_at: NOW - SESSION_TTL_MS - 1 }), identity, ids, NOW)).toBeNull();
    expect(restoreSession(record({ saved_at: NOW - SESSION_TTL_MS + 1 }), identity, ids, NOW)).not.toBeNull();
  });

  it("accepts an answered question missing from what the server served", () => {
    // The normal case in mode "due": answering moved its due date, so the session endpoint no
    // longer returns it. Without this the record would be thrown away after the first answer —
    // exactly when it starts being worth something.
    expect(restoreSession(record({ states: answered }), identity, ["b"], NOW)).not.toBeNull();
  });

  it("accepts a given-up question missing from what the server served", () => {
    expect(restoreSession(record({ states: { a: { kind: "given_up" } } }), identity, ["b"], NOW)).not.toBeNull();
  });

  it("refuses when a question that was never dealt with has disappeared", () => {
    // The block itself changed underneath (re-imported, question deleted): nothing about the old
    // record can be trusted, so it goes whole rather than being grafted on.
    expect(restoreSession(record({ states: { a: { kind: "skipped" } } }), identity, ["a"], NOW)).toBeNull();
    expect(restoreSession(record(), identity, ["a"], NOW)).toBeNull();
    expect(restoreSession(record(), identity, [], NOW)).toBeNull();
  });

  it("restores a finished session even though the block now serves nothing", () => {
    // Where the marked-words list is rescued: every question is answered, so the block has nothing
    // due left, and only this record can still get the learner back to the results screen.
    const finished = record({
      index: 1,
      states: { a: { kind: "answered", selected: 1, result }, b: { kind: "answered", selected: 2, result } },
      marked: [{ lemma: "가다", gloss_vi: "đi", source: { section: "listening", exam: "e", number: 21 } }],
    });
    const restored = restoreSession(finished, identity, [], NOW);
    expect(restored?.marked).toHaveLength(1);
  });
});

describe("trimForQuota", () => {
  it("keeps the group being answered, its marks, and makes it group 0", () => {
    const r = record({
      questions: [question("a", 21, "clip1"), question("b", 22, "clip1"), question("c", 23, "clip2")],
      index: 1,
      marked: [{ lemma: "가다", gloss_vi: "đi", source: { section: "listening", exam: "e", number: 21 } }],
    });
    const small = trimForQuota(r);
    expect(small.questions.map((q) => q.id)).toEqual(["c"]);
    expect(small.index).toBe(0);
    expect(small.marked).toEqual(r.marked);
  });

  it("still produces a readable record when the index is past the end", () => {
    const small = trimForQuota(record({ index: 9 }));
    expect(savedSessionSchema.safeParse(small).success).toBe(true);
  });
});
