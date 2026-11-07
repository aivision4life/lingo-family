/**
 * What the sitting's header says about where you are (M7.14).
 *
 * Four states, which is three too many for a ternary in JSX (SPEC §11): a question on its own or a
 * pair sharing a recording, in a paper sat from the beginning or in a range. Sitting questions
 * 21-30 used to read "Câu 21 / 10" — the position against the *count* — which is nonsense. A paper
 * sat from question 1 keeps the familiar "Câu 7 / 20"; anything else names the range instead.
 */
export type SittingHeader =
  | { kind: "single"; number: number; total: number }
  | { kind: "pair"; first: number; last: number; total: number }
  | { kind: "singleInRange"; number: number; from: number; to: number }
  | { kind: "pairInRange"; first: number; last: number; from: number; to: number };

export function sittingHeader(
  group: { from: number; to: number },
  range: { from: number | null; to: number | null },
  questionCount: number,
): SittingHeader {
  const pair = group.to > group.from;
  // A sitting from before ranges were stored (`from === null`) reads as a whole paper.
  // A sitting that starts at question 1 is a paper being sat, whatever its length; one that starts
  // anywhere else is a range being drilled, and the range is the useful context.
  if (range.from === null || range.to === null || range.from === 1) {
    return pair
      ? { kind: "pair", first: group.from, last: group.to, total: questionCount }
      : { kind: "single", number: group.from, total: questionCount };
  }
  return pair
    ? { kind: "pairInRange", first: group.from, last: group.to, from: range.from, to: range.to }
    : { kind: "singleInRange", number: group.from, from: range.from, to: range.to };
}
