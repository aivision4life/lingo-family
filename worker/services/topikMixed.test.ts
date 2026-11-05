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
  it("offers 20 and 30 with the position that is missing", () => {
    const options = mixedLengthOptions(bank(["a"], 24));
    expect(options.map((o) => [o.length, o.available, o.missing_position])).toEqual([
      [20, true, null],
      [30, false, 25],
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
    const plan = planMixedTest({ candidates: bank(["a", "b"], 24), length: 22, seen, random: pinned(0) });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.picks.map((p) => p.position)).toEqual([...Array(22)].map((_, i) => i + 1));
  });

  it("takes both questions of a pair from the same paper", () => {
    const plan = planMixedTest({ candidates: bank(["a", "b"], 24), length: 22, seen, random: pinned(0, 0, 0, 0.99) });
    if (!plan.ok) throw new Error("expected a plan");
    const pair = plan.picks.filter((p) => p.position === 21 || p.position === 22);
    expect(pair).toHaveLength(2);
    expect(new Set(pair.map((p) => p.group_id)).size).toBe(1);
    expect(new Set(pair.map((p) => p.exam)).size).toBe(1);
  });

  it("never half-takes a pair that would run past the asked length", () => {
    // 21 only exists as the pair 21-22, so a 21-question test cannot include it.
    const plan = planMixedTest({ candidates: bank(["a"], 24), length: 21, seen, random: pinned(0) });
    expect(plan).toEqual({ ok: false, missingPosition: 21 });
  });

  it("reports the position it ran out at instead of a short test", () => {
    const plan = planMixedTest({ candidates: bank(["a"], 12), length: 20, seen, random: pinned(0) });
    expect(plan).toEqual({ ok: false, missingPosition: 13 });
  });

  it("mixes papers: one sitting is not one exam", () => {
    const plan = planMixedTest({ candidates: bank(["a", "b"], 20), length: 20, seen, random: pinned(0, 0.99, 0, 0.99) });
    if (!plan.ok) throw new Error("expected a plan");
    expect(new Set(plan.picks.map((p) => p.exam)).size).toBe(2);
  });

  it("prefers a question the profile has not seen, whatever the random says", () => {
    // Paper "a" was asked in the most recent sitting; the draw must take "b" even though the
    // random would otherwise land on "a".
    const recent = new Map([["a-1", 1]]);
    const plan = planMixedTest({ candidates: [clip("a", [1]), clip("b", [1])], length: 1, seen: recent, random: pinned(0) });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.picks[0]!.exam).toBe("b");
  });

  it("reuses the clip seen longest ago once everything has been seen", () => {
    const all = new Map([
      ["a-1", 1],
      ["b-1", 3],
      ["c-1", 2],
    ]);
    const plan = planMixedTest({ candidates: [clip("a", [1]), clip("b", [1]), clip("c", [1])], length: 1, seen: all, random: pinned(0) });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.picks[0]!.exam).toBe("b");
  });

  it("treats a pair as seen when either half was asked recently", () => {
    // Only the second half was answered last time, but the two questions are one clip: it counts
    // as seen, so the untouched paper wins.
    const half = new Map([["a-2", 1]]);
    const plan = planMixedTest({ candidates: [clip("a", [1, 2]), clip("b", [1, 2])], length: 2, seen: half, random: pinned(0) });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.picks.every((p) => p.exam === "b")).toBe(true);
  });

  it("spreads its choice across the candidates as the random moves", () => {
    const candidates = [clip("a", [1]), clip("b", [1]), clip("c", [1])];
    const exams = [0, 0.5, 0.99].map((r) => {
      const plan = planMixedTest({ candidates, length: 1, seen, random: () => r });
      return plan.ok ? plan.picks[0]!.exam : "?";
    });
    expect(exams).toEqual(["a", "b", "c"]);
  });

  it("stays in range when the random returns exactly 1", () => {
    const plan = planMixedTest({ candidates: [clip("a", [1]), clip("b", [1])], length: 1, seen, random: () => 1 });
    expect(plan.ok).toBe(true);
  });
});
