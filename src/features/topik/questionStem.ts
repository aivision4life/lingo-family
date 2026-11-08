// What a question's stem block shows — the rule that was wrong in the first reading sitting
// (M7.11): the screen printed the instruction and the four options and nothing to read.
//
// The two sections mean opposite things by "stem". A reading question's stem *is* the question:
// the passage, the notice, the sentence with the gap. A listening question's stem is the
// transcript of its recording, which is the answer read out loud, so the server sends null for it
// while the question is unanswered. The card that showed only `stem.image_key` was written against
// the listening paper, where a stem never had text to show, and the reading paper inherited it.
//
// It lives here, as a function, because a display decision with more than two branches is one a
// test has to be able to call (SPEC §11).

import { splitBoxedSentence } from "@shared/topik";

export type Stem = { text: string | null; image_key: string | null };

/**
 * The stem block to render, or `null` for no block at all.
 *
 * `hasClip` is belt and braces: a question with a recording has its clip on the screen above and
 * its stem is that recording's transcript, so even a server that leaked the text must not have it
 * printed over the questions it answers.
 */
export function stemView(stem: Stem, { hasClip }: { hasClip: boolean }): Stem | null {
  if (hasClip) return null;
  if (stem.text === null && stem.image_key === null) return null;
  return stem;
}

/**
 * The one stem a whole group shares, or null when each question has its own (M7.21).
 *
 * A reading pair is two questions about one passage, and the passage is stored on **both** of them
 * (SPEC §10 — one copy each, which is its own problem). Before they were grouped that was invisible,
 * because each question had its own screen; putting them on one screen printed the same 191
 * characters twice, one above the other. So the group draws it once and the cards leave it out.
 *
 * Every condition has to hold, and "every" is the point: two questions whose stems merely *look*
 * alike are two questions, and a group of one has nothing to share. An image-only stem counts too
 * (both keys must match), because a chart asked about twice is still one chart.
 */
export function sharedStem(stems: readonly (Stem | null)[]): Stem | null {
  if (stems.length < 2) return null;
  const [first] = stems;
  if (!first) return null;
  // Compared on the **passage** only (M7.23): question 46 carries a `<보 기>` sentence of its own
  // at the end of its stem, and 47 does not, yet the passage above them is one passage.
  const passage = splitBoxedSentence(first.text).passage;
  if (passage === null && first.image_key === null) return null;
  const same = stems.every((s) => s !== null && splitBoxedSentence(s.text).passage === passage && s.image_key === first.image_key);
  return same ? { text: passage, image_key: first.image_key } : null;
}

/**
 * What one question still has to draw once the group drew the shared passage (M7.23).
 *
 * Almost always nothing. The exception is the sentence that question alone has to place: it was
 * typed at the end of its own stem, after a `<보 기>` line, and it is not part of what the group
 * shares — so it stays with its question, under its own options' heading.
 */
export function ownStemBesideShared(stem: Stem | null): Stem | null {
  const boxed = splitBoxedSentence(stem?.text).boxed;
  return boxed === null ? null : { text: boxed, image_key: null };
}
