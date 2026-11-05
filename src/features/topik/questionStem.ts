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
