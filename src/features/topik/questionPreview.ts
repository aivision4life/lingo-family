// Pure text helpers for the review screen's per-row preview (so each row is self-describing even
// out of its exam group's context, with ~600 rows expected eventually).

/** Trims to at most `max` characters, trailing whitespace stripped before the ellipsis. */
export function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

/**
 * Key terms (M6.3 lemmas) joined with the question's own `vocab` for their meaning, for the
 * read-only view screen (M6.7). The server does the same join for a practice attempt, but there it
 * also adds per-profile new/weak/known status; here the adult is only checking the content, so the
 * gloss is all that is needed. A lemma with no matching vocab entry is kept (with an empty gloss)
 * rather than dropped: on this screen a missing join is itself something worth seeing.
 */
export function keyTermRows(
  key_terms: readonly string[],
  vocab: readonly { lemma: string; pos: string; gloss_vi: string }[],
): { lemma: string; pos: string; gloss_vi: string }[] {
  return key_terms.map((lemma) => {
    const entry = vocab.find((v) => v.lemma === lemma);
    return { lemma, pos: entry?.pos ?? "", gloss_vi: entry?.gloss_vi ?? "" };
  });
}
