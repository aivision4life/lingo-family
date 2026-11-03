import { describe, expect, it } from "vitest";
import { applyReview, emptyCardFields, type CardFields } from "../../shared/scheduling";
import { buildTopikSession } from "./topikScheduling";

const NOW = new Date("2026-10-15T00:00:00Z");
const PAST = new Date("2026-10-01T00:00:00Z");
const FUTURE = new Date("2026-11-01T00:00:00Z");

const dueAt = (date: Date, lapses = 0): CardFields => ({ ...emptyCardFields(PAST), due: date, lapses });

describe("buildTopikSession", () => {
  it("overdue-and-wrong first, then never-attempted, then overdue-but-clean", () => {
    const cands = [
      { question_id: "clean-due", group_id: "clean-due", card: dueAt(PAST, 0) },
      { question_id: "wrong-due", group_id: "wrong-due", card: dueAt(PAST, 2) },
      { question_id: "never", group_id: "never", card: null },
    ];
    expect(buildTopikSession(cands, NOW)).toEqual(["wrong-due", "never", "clean-due"]);
  });

  it("leaves out a question that is not yet due and has never been gotten wrong", () => {
    const cands = [
      { question_id: "not-due", group_id: "not-due", card: dueAt(FUTURE, 0) },
      { question_id: "never", group_id: "never", card: null },
    ];
    expect(buildTopikSession(cands, NOW)).toEqual(["never"]);
  });

  it("within a tier, the most overdue question comes first", () => {
    const cands = [
      { question_id: "less-overdue", group_id: "less-overdue", card: dueAt(new Date("2026-10-10T00:00:00Z"), 1) },
      { question_id: "more-overdue", group_id: "more-overdue", card: dueAt(new Date("2026-10-02T00:00:00Z"), 1) },
    ];
    expect(buildTopikSession(cands, NOW)).toEqual(["more-overdue", "less-overdue"]);
  });

  it("caps at the given limit", () => {
    const cands = Array.from({ length: 15 }, (_, i) => ({ question_id: `q${i}`, group_id: `q${i}`, card: null }));
    expect(buildTopikSession(cands, NOW, "due", 10)).toHaveLength(10);
  });

  // M7.2: "practise anyway". The schedule is ignored for picking, but the tiers stay the same so
  // the questions that need work still come first.
  it("mode 'all' adds the not-yet-due questions as a last tier, soonest first", () => {
    const cands = [
      { question_id: "later", group_id: "later", card: dueAt(new Date("2026-11-20T00:00:00Z")) },
      { question_id: "sooner", group_id: "sooner", card: dueAt(FUTURE) },
      { question_id: "new", group_id: "new", card: null },
      { question_id: "overdue", group_id: "overdue", card: dueAt(PAST) },
    ];
    expect(buildTopikSession(cands, NOW)).toEqual(["new", "overdue"]);
    expect(buildTopikSession(cands, NOW, "all")).toEqual(["new", "overdue", "sooner", "later"]);
  });

  it("mode 'all' changes nothing when everything is already due or new", () => {
    const cands = [
      { question_id: "new", group_id: "new", card: null },
      { question_id: "overdue", group_id: "overdue", card: dueAt(PAST) },
    ];
    expect(buildTopikSession(cands, NOW, "all")).toEqual(buildTopikSession(cands, NOW));
  });

  it("a real FSRS lapse (graduates, then one 'Again') produces a candidate that lands in the wrong-tier next time it's due", () => {
    const { card: graduated } = applyReview(emptyCardFields(PAST), 4, PAST); // Easy: New → Review
    const { card: lapsed } = applyReview(graduated, 1, graduated.due); // Again: a real lapse
    expect(lapsed.lapses).toBeGreaterThan(0);
    const stillDue = { ...lapsed, due: PAST }; // force it due again for this test
    const cands = [
      { question_id: "reviewed-wrong", group_id: "reviewed-wrong", card: stillDue },
      { question_id: "never", group_id: "never", card: null },
    ];
    expect(buildTopikSession(cands, NOW)).toEqual(["reviewed-wrong", "never"]);
  });

  // M7.5: two questions asked about one recording. The session takes them together or not at all —
  // the tape plays once, so the second half of a pair is unanswerable in a later session.
  describe("a pair that shares one clip", () => {
    const pair = (n: number, card: CardFields | null = null) => [
      { question_id: `q${n}`, group_id: `clip${n}`, card },
      { question_id: `q${n + 1}`, group_id: `clip${n}`, card },
    ];

    it("takes both halves even when the limit falls between them", () => {
      const cands = [...Array.from({ length: 4 }, (_, i) => ({ question_id: `s${i}`, group_id: `s${i}`, card: null })), ...pair(21)];
      // Asked for 5; the fifth is the first half of a pair, so the session comes back with 6.
      expect(buildTopikSession(cands, NOW, "due", 5)).toEqual(["s0", "s1", "s2", "s3", "q21", "q22"]);
    });

    it("never returns half a pair", () => {
      const session = buildTopikSession([...pair(21), ...pair(23)], NOW, "due", 3);
      expect(session).toEqual(["q21", "q22", "q23", "q24"]);
    });

    it("keeps the pair in question order whichever half earned its place", () => {
      // The second half is the one that is overdue and was gotten wrong; the first still leads.
      const cands = [
        { question_id: "q21", group_id: "clip21", card: null },
        { question_id: "q22", group_id: "clip21", card: dueAt(PAST, 3) },
      ];
      expect(buildTopikSession(cands, NOW, "due", 2)).toEqual(["q21", "q22"]);
    });

    it("counts a pair as two questions towards the limit", () => {
      const cands = [...pair(21), ...pair(23), ...pair(25)];
      expect(buildTopikSession(cands, NOW, "due", 4)).toEqual(["q21", "q22", "q23", "q24"]);
    });
  });
});
