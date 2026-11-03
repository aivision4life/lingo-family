// Drawing a mixed mock test (M6.5): each position filled from the whole question bank instead of
// from one paper. Pure — no D1, no randomness of its own — so every rule below is unit tested.
import type { TopikTestLength } from "../../shared/topik";
import type { TestLengthOption } from "./topikTest";

/**
 * One clip of one paper, with every question asked about it.
 *
 * The clip is the unit a draw takes, never the question: from number 21 a clip carries a pair, and
 * taking "question 21" has to mean taking 21 and 22 from the same paper. That pairing is not a
 * flag anyone has to remember — two questions sharing a clip simply share a `segment_id`, so it is
 * already in the data and cannot be got wrong here.
 */
export type MixedCandidate = {
  segment_id: string;
  exam: string;
  /** Question numbers on this clip, ascending. */
  numbers: number[];
  /** Question ids, in the same order as `numbers`. */
  question_ids: string[];
};

export type MixedPick = { position: number; question_id: string; segment_id: string; exam: string };

/**
 * How recently each question was put in front of this profile: 1 = the most recent sitting, 2 = the
 * one before it, and so on. A question that is absent has not been seen in the window at all.
 */
export type SeenRanks = ReadonlyMap<string, number>;

const lastNumber = (c: MixedCandidate) => Math.max(...c.numbers);

/** Clips whose numbers run straight on from `at`, grouped by where they start. */
function candidatesStartingAt(candidates: readonly MixedCandidate[], at: number): MixedCandidate[] {
  return candidates.filter((c) => {
    const sorted = [...c.numbers].sort((a, b) => a - b);
    return sorted[0] === at && sorted.every((n, i) => n === at + i);
  });
}

/**
 * How far a draw could get: it walks the positions and stops where no clip begins.
 *
 * When clips at one position disagree about how many questions they carry — one paper pairing
 * 21-22 where another has 21 alone — the walk advances by the *smallest* of them, so the reported
 * reach is the one every paper can actually fill.
 */
export function reachableLength(candidates: readonly MixedCandidate[]): number {
  let position = 1;
  for (;;) {
    const here = candidatesStartingAt(candidates, position);
    if (here.length === 0) return position - 1;
    position += Math.min(...here.map((c) => c.numbers.length));
  }
}

/** The first position with no clip at all, which is what makes a length unavailable. */
export function firstMissingPosition(candidates: readonly MixedCandidate[], length: number): number | null {
  const reach = reachableLength(candidates);
  return reach >= length ? null : reach + 1;
}

export type MixedLengthOption = TestLengthOption & { missing_position: number | null };

/** The three lengths for the mixed card, each saying why it cannot be taken. */
export function mixedLengthOptions(candidates: readonly MixedCandidate[]): MixedLengthOption[] {
  const reach = reachableLength(candidates);
  const fixed = [20, 30] as const;
  const options = fixed.map((length) => ({
    length: length as TopikTestLength,
    available: reach >= length,
    questions: length as number,
    missing_position: firstMissingPosition(candidates, length),
  }));
  return [...options, { length: "full" as const, available: reach > 0, questions: reach, missing_position: reach > 0 ? null : 1 }];
}

/**
 * Picks the clips for one mixed sitting.
 *
 * Questions the profile has not met in its last few sittings come first; only when every clip at a
 * position has been seen does it reuse one, and then the one seen longest ago. With a bank of two
 * papers the third mixed test in a row has no choice but to repeat — preferring the oldest is what
 * keeps the repeats spread out instead of landing on the same paper every time.
 */
export function planMixedTest(args: {
  candidates: readonly MixedCandidate[];
  length: number;
  seen: SeenRanks;
  /** Injected so a test can pin the choice; `Math.random` in the Worker. */
  random: () => number;
}): { ok: true; picks: MixedPick[] } | { ok: false; missingPosition: number } {
  const picks: MixedPick[] = [];
  let position = 1;

  while (position <= args.length) {
    const here = candidatesStartingAt(args.candidates, position).filter((c) => lastNumber(c) <= args.length);
    if (here.length === 0) return { ok: false, missingPosition: position };

    const chosen = pickCandidate(here, args.seen, args.random);
    const ordered = [...chosen.numbers.keys()].sort((a, b) => chosen.numbers[a]! - chosen.numbers[b]!);
    for (const i of ordered) {
      picks.push({ position: chosen.numbers[i]!, question_id: chosen.question_ids[i]!, segment_id: chosen.segment_id, exam: chosen.exam });
    }
    position = lastNumber(chosen) + 1;
  }

  return { ok: true, picks };
}

/** Unseen clips first; among equals, the one whose most recent showing is furthest back. */
function pickCandidate(here: readonly MixedCandidate[], seen: SeenRanks, random: () => number): MixedCandidate {
  // A clip's own recency is its *most recently* seen question: a pair where one half was asked
  // last time has been seen, whatever the other half says.
  const recency = (c: MixedCandidate) => {
    const ranks = c.question_ids.map((id) => seen.get(id)).filter((r): r is number => r !== undefined);
    return ranks.length === 0 ? Infinity : Math.min(...ranks);
  };
  const best = Math.max(...here.map(recency));
  const tier = here.filter((c) => recency(c) === best);
  return tier[Math.min(tier.length - 1, Math.floor(random() * tier.length))]!;
}
