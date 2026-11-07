// Which questions a sitting covers (M7.14): "câu 21 đến 30", not "20 questions".
//
// A mock test used to come in three sizes — 20, 30, the whole paper, always counting from question
// 1. That is the right thing for sitting a paper, and the wrong thing for drilling one kind of
// question (only 16-18, say), which is most of what practice actually is. So a sitting now covers a
// **range**, the three sizes are just quick ways to fill one in, and these are its rules.
//
// Pure on purpose: both the server (which decides) and the picker screen (which explains) run the
// very same functions, so what the screen promises and what the server does cannot drift apart.

/**
 * Questions that must be taken together, ascending: the pair sharing one recording from number 21
 * on, and — once the reading bank has them typed up — a passage's own pair (19-20, 23-24, …).
 *
 * Deliberately plain data. Nothing here knows which section it is looking at; the caller builds the
 * groups from whatever the section's data says shares a thing (today: a clip's `segment_id`, or the
 * question's own id when it stands alone). A reading paper with pairs therefore needs no new rule
 * here, only groups that say so.
 */
export type QuestionGroup = readonly number[];

export type NumberRange = { from: number; to: number };

/** How many questions a range covers. */
export const rangeCount = (range: NumberRange) => Math.max(0, range.to - range.from + 1);

/**
 * Widens a range until it holds whole groups.
 *
 * Asking for 1-21 when 21 and 22 share a recording cannot be honoured: the tape would play the
 * answer to a question the paper does not include. So 1-21 becomes 1-22, and 22-30 becomes 21-30.
 *
 * Several groups may claim one number — a mixed sitting draws each position from a different paper,
 * and one paper may pair 21-22 where another has 21 standing alone. The widening then takes the
 * **union**: if any group straddles the edge, the edge moves, because the draw may well land on
 * that paper. Widening can expose a further group (a paper pairing 23-24 next to one pairing
 * 24-25), so it runs to a fixed point rather than once.
 */
export function expandToGroups(range: NumberRange, groups: readonly QuestionGroup[]): NumberRange & { expanded: boolean } {
  let { from, to } = range;
  // Each pass can only widen, and never past the groups' own bounds, so this terminates; the cap
  // is a guard against a caller handing in nonsense (a group whose numbers are not ascending).
  for (let pass = 0; pass < groups.length + 1; pass++) {
    let moved = false;
    for (const group of groups) {
      if (group.length === 0) continue;
      const first = Math.min(...group);
      const last = Math.max(...group);
      // A group is only relevant when it overlaps the range at all.
      if (last < from || first > to) continue;
      if (first < from) {
        from = first;
        moved = true;
      }
      if (last > to) {
        to = last;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { from, to, expanded: from !== range.from || to !== range.to };
}

/**
 * The first question of the range the bank does not have, or null when it has all of them.
 *
 * A hole is never skipped over. "Câu 16 đến 20" with no question 18 is not a four-question test —
 * it is a request that cannot be honoured, and saying which number is missing is something the
 * owner can act on, unlike "not enough questions".
 */
export function missingNumber(range: NumberRange, available: ReadonlySet<number>): number | null {
  for (let n = range.from; n <= range.to; n++) {
    if (!available.has(n)) return n;
  }
  return null;
}

/** Longest range the three shortcut buttons may fill, and the most a sitting can cover at once. */
export const MAX_RANGE_QUESTIONS = 50;

/** A range the three shortcuts stand for: "20" is questions 1-20, never "20 questions from here". */
export const shortcutRange = (count: number): NumberRange => ({ from: 1, to: Math.max(1, count) });
