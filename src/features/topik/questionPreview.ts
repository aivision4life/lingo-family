// Pure text helpers for the review screen's per-row preview (so each row is self-describing even
// out of its exam group's context, with ~600 rows expected eventually).

/** Trims to at most `max` characters, trailing whitespace stripped before the ellipsis. */
export function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}
