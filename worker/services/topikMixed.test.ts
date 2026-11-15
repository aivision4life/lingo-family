import { describe, expect, it } from "vitest";
import { mixedLengthOptions, planMixedTest, reachableLength, type MixedCandidate } from "./topikMixed";

/** A clip of `exam` carrying the questions `numbers`, with ids like "36-21". */
const clip = (exam: string, numbers: number[]): MixedCandidate => ({
  group_id: `${exam}-s${numbers[0]}`,
  exam,
  numbers,
  question_ids: numbers.map((n) => `${exam}-${n}`),
});

/** Two papers of `upTo` questions each: singles to 20, then pairs, exactly like a real paper. */
function bank(exams: string[], upTo: number): MixedCandidate[] {
  const out: MixedCandidate[] = [];
  for (const exam of exams) {
    let n = 1;
    while (n <= upTo) {
      // Questions 1-20 are one clip each; from 21 a clip carries a pair, as a real paper does.
      const numbers = n < 21 ? [n] : [n, n + 1];
      out.push(clip(exam, numbers));
      n += numbers.length;
    }
  }
  return out;
}

const pinned = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
};

describe("reachableLength", () => {
  it("stops at the first position no clip starts at", () => {
    expect(reachableLength([clip("a", [1]), clip("a", [2]), clip("a", [4])])).toBe(2);
  });

  it("counts a pair as the two questions it carries", () => {
    expect(reachableLength([clip("a", [1]), clip("a", [2, 3])])).toBe(3);
  });

  it("advances by the shortest clip when the papers disagree", () => {
    // One paper pairs 2-3, the other asks 2 alone and nothing at 3: reach is what both can fill.
    expect(reachableLength([clip("a", [1]), clip("a", [2, 3]), clip("b", [2])])).toBe(2);
  });

  it("is zero for a bank with nothing at question 1", () => {
    expect(reachableLength([clip("a", [2]), clip("a", [3])])).toBe(0);
  });
});

describe("mixedLengthOptions", () => {
  it("offers 20 and 32 with the position that is missing", () => {
    const options = mixedLengthOptions(bank(["a"], 24));
    expect(options.map((o) => [o.length, o.available, o.missing_position])).toEqual([
      [20, true, null],
      [32, false, 25],
      ["full", true, null],
    ]);
  });

  it("reports full as the real reach, not as the longest fixed length", () => {
    expect(mixedLengthOptions(bank(["a", "b"], 24)).at(-1)).toMatchObject({ length: "full", questions: 24, available: true });
  });

  it("offers nothing at all for an empty bank", () => {
    expect(mixedLengthOptions([]).every((o) => !o.available)).toBe(true);
  });
});

describe("planMixedTest", () => {
  const seen = new Map<string, number>();

  it("fills every position from 1 to the asked length", () => {
    const plan = planMixedTest({ candidates: bank(["a", "b"], 24), from: 1, to: 22, seen, random: pinned(0) });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.picks.map((p) => p.position)).toEqual([...Array(22)].map((_, i) => i + 1));
  });

  it("takes both questions of a pair from the same paper", () => {
    const plan = planMixedTest({ candidates: bank(["a", "b"], 24), from: 1, to: 22, seen, random: pinned(0, 0, 0, 0.99) });
    if (!plan.ok) throw new Error("expected a plan");
    const pair = plan.picks.filter((p) => p.position === 21 || p.position === 22);
    expect(pair).toHaveLength(2);
    expect(new Set(pair.map((p) => p.group_id)).size).toBe(1);
    expect(new Set(pair.map((p) => p.exam)).size).toBe(1);
  });

  it("never half-takes a pair that would run past the asked length", () => {
    // 21 only exists as the pair 21-22, so a 21-question test cannot include it.
    const plan = planMixedTest({ candidates: bank(["a"], 24), from: 1, to: 21, seen, random: pinned(0) });
    expect(plan).toEqual({ ok: false, missingPosition: 21 });
  });

  it("reports the position it ran out at instead of a short test", () => {
    const plan = planMixedTest({ candidates: bank(["a"], 12), from: 1, to: 20, seen, random: pinned(0) });
    expect(plan).toEqual({ ok: false, missingPosition: 13 });
  });

  it("mixes papers: one sitting is not one exam", () => {
    const plan = planMixedTest({ candidates: bank(["a", "b"], 20), from: 1, to: 20, seen, random: pinned(0, 0.99, 0, 0.99) });
    if (!plan.ok) throw new Error("expected a plan");
    expect(new Set(plan.picks.map((p) => p.exam)).size).toBe(2);
  });

  it("prefers a question the profile has not seen, whatever the random says", () => {
    // Paper "a" was asked in the most recent sitting; the draw must take "b" even though the
    // random would otherwise land on "a".
    const recent = new Map([["a-1", 1]]);
    const plan = planMixedTest({ candidates: [clip("a", [1]), clip("b", [1])], from: 1, to: 1, seen: recent, random: pinned(0) });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.picks[0]!.exam).toBe("b");
  });

  it("reuses the clip seen longest ago once everything has been seen", () => {
    const all = new Map([
      ["a-1", 1],
      ["b-1", 3],
      ["c-1", 2],
    ]);
    const plan = planMixedTest({ candidates: [clip("a", [1]), clip("b", [1]), clip("c", [1])], from: 1, to: 1, seen: all, random: pinned(0) });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.picks[0]!.exam).toBe("b");
  });

  it("treats a pair as seen when either half was asked recently", () => {
    // Only the second half was answered last time, but the two questions are one clip: it counts
    // as seen, so the untouched paper wins.
    const half = new Map([["a-2", 1]]);
    const plan = planMixedTest({ candidates: [clip("a", [1, 2]), clip("b", [1, 2])], from: 1, to: 2, seen: half, random: pinned(0) });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.picks.every((p) => p.exam === "b")).toBe(true);
  });

  it("spreads its choice across the candidates as the random moves", () => {
    const candidates = [clip("a", [1]), clip("b", [1]), clip("c", [1])];
    const exams = [0, 0.5, 0.99].map((r) => {
      const plan = planMixedTest({ candidates, from: 1, to: 1, seen, random: () => r });
      return plan.ok ? plan.picks[0]!.exam : "?";
    });
    expect(exams).toEqual(["a", "b", "c"]);
  });

  it("stays in range when the random returns exactly 1", () => {
    const plan = planMixedTest({ candidates: [clip("a", [1]), clip("b", [1])], from: 1, to: 1, seen, random: () => 1 });
    expect(plan.ok).toBe(true);
  });

  // M7.28: what is still to be learnt comes before what is already known, so a sitting does not
  // spend its 20 questions on the ones the learner has mastered.
  describe("priority: unanswered, then not mastered, then the rest", () => {
    const ids = (c: MixedCandidate) => c.question_ids;

    it("takes the unanswered clip over one answered but not mastered", () => {
      const a = clip("a", [1]); // answered, not mastered
      const b = clip("b", [1]); // never answered
      const plan = planMixedTest({
        candidates: [a, b],
        from: 1,
        to: 1,
        seen,
        answered: new Set(ids(a)),
        mastered: new Set<string>(),
        random: pinned(0),
      });
      if (!plan.ok) throw new Error("expected a plan");
      expect(plan.picks[0]!.exam).toBe("b");
    });

    it("takes the not-mastered clip over a mastered one", () => {
      const a = clip("a", [1]); // answered and mastered
      const b = clip("b", [1]); // answered, still learning
      const plan = planMixedTest({
        candidates: [a, b],
        from: 1,
        to: 1,
        seen,
        answered: new Set([...ids(a), ...ids(b)]),
        mastered: new Set(ids(a)),
        random: pinned(0),
      });
      if (!plan.ok) throw new Error("expected a plan");
      expect(plan.picks[0]!.exam).toBe("b");
    });

    it("prefers a question never answered even when it was in the most recent sitting", () => {
      // The ranking is by group first: an unanswered question that only *played* in an abandoned
      // sitting still counts as work to do, so recency cannot promote the mastered clip over it.
      const a = clip("a", [1]); // answered and mastered, not seen lately
      const b = clip("b", [1]); // never answered, but played last sitting
      const plan = planMixedTest({
        candidates: [a, b],
        from: 1,
        to: 1,
        seen: new Map([["b-1", 1]]),
        answered: new Set(ids(a)),
        mastered: new Set(ids(a)),
        random: pinned(0),
      });
      if (!plan.ok) throw new Error("expected a plan");
      expect(plan.picks[0]!.exam).toBe("b");
    });

    it("keeps the old rules inside one group: seen longest ago, then the random", () => {
      // All three are answered and not mastered, so recency decides and picks "b".
      const cs = [clip("a", [1]), clip("b", [1]), clip("c", [1])];
      const plan = planMixedTest({
        candidates: cs,
        from: 1,
        to: 1,
        seen: new Map([
          ["a-1", 1],
          ["b-1", 3],
          ["c-1", 2],
        ]),
        answered: new Set(cs.flatMap(ids)),
        mastered: new Set<string>(),
        random: pinned(0),
      });
      if (!plan.ok) throw new Error("expected a plan");
      expect(plan.picks[0]!.exam).toBe("b");
    });

    it("puts a whole pair in the unanswered group when one half is unanswered", () => {
      // "a" has 21 answered and mastered but 22 never answered; "b" is answered throughout and
      // not mastered. Judged by its weakest question, "a" is the needier pair.
      const a = clip("a", [21, 22]);
      const b = clip("b", [21, 22]);
      const plan = planMixedTest({
        candidates: [a, b],
        from: 21,
        to: 22,
        seen,
        answered: new Set(["a-21", ...ids(b)]),
        mastered: new Set(["a-21"]),
        random: pinned(0),
      });
      if (!plan.ok) throw new Error("expected a plan");
      expect(plan.picks.every((p) => p.exam === "a")).toBe(true);
    });

    it("falls back to the mastered clips rather than failing the position", () => {
      const cs = [clip("a", [1]), clip("b", [1])];
      const all = new Set(cs.flatMap(ids));
      const plan = planMixedTest({ candidates: cs, from: 1, to: 1, seen, answered: all, mastered: all, random: pinned(0) });
      if (!plan.ok) throw new Error("expected a plan");
      expect(plan.picks).toHaveLength(1);
    });

    it("ranks by recency alone when no history is passed in (the range preview)", () => {
      const plan = planMixedTest({
        candidates: [clip("a", [1]), clip("b", [1])],
        from: 1,
        to: 1,
        seen: new Map([["a-1", 1]]),
        random: pinned(0),
      });
      if (!plan.ok) throw new Error("expected a plan");
      expect(plan.picks[0]!.exam).toBe("b");
    });
  });
  // M7.14: a mixed sitting can start anywhere, which is the whole point of drilling one kind of
  // question — "câu 16 đến 18, each from a different paper".
  describe("over a range that does not start at 1", () => {
    it("fills only the asked positions", () => {
      const candidates = [clip("a", [16]), clip("a2", [17]), clip("a3", [18]), clip("a4", [19])];
      const plan = planMixedTest({ candidates, from: 16, to: 18, seen, random: pinned(0) });
      if (!plan.ok) throw new Error("expected a plan");
      expect(plan.picks.map((p) => p.position)).toEqual([16, 17, 18]);
    });

    it("names the position the bank ran out at, counting inside the range", () => {
      const candidates = [clip("a", [16]), clip("b", [18])];
      const plan = planMixedTest({ candidates, from: 16, to: 18, seen, random: pinned(0) });
      expect(plan).toEqual({ ok: false, missingPosition: 17 });
    });

    it("draws a pair whole when the range starts on one", () => {
      const candidates = [clip("a", [21, 22]), clip("b", [23, 24])];
      const plan = planMixedTest({ candidates, from: 21, to: 24, seen, random: pinned(0) });
      if (!plan.ok) throw new Error("expected a plan");
      expect(plan.picks.map((p) => p.position)).toEqual([21, 22, 23, 24]);
    });

    it("refuses a pair that would hang out of the range rather than cutting it", () => {
      // The caller widens the range first (`expandToGroups`); if something still asks for 21-21
      // with only a 21-22 clip to offer, nothing is drawn — half a pair is never a sitting.
      const plan = planMixedTest({ candidates: [clip("a", [21, 22])], from: 21, to: 21, seen, random: pinned(0) });
      expect(plan).toEqual({ ok: false, missingPosition: 21 });
    });
  });
});
