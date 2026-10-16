// Splits a TOPIK question's text into tappable/non-tappable spans (M6.2). Korean attaches grammar
// endings without a space (e.g. "학교에서" = 학교 + 에서), so a whitespace split cannot tell which
// part was tapped — instead, each AI-found `surface` form is matched as an exact substring,
// longest-match-first, and whatever is left over (particles, punctuation, spaces) is not tappable.
import type { TopikVocabEntry } from "@shared/topik";

export type VocabSegment = { text: string; entry: TopikVocabEntry | null };

/**
 * A grammar ending/particle entry (pos "other" or "particle") is not real picture-library
 * vocabulary — drawing an image for "-자마자" is both meaningless and a wasted image quota unit —
 * so the "tap a word" popup offers only its meaning, never an "Add to library" action.
 */
export function isGrammarEntry(pos: TopikVocabEntry["pos"]): boolean {
  return pos === "other" || pos === "particle";
}

/** First entry wins for a repeated `surface` (the AI is asked to list each one only once). */
function dedupeBySurface(vocab: TopikVocabEntry[]): TopikVocabEntry[] {
  const seen = new Set<string>();
  const out: TopikVocabEntry[] = [];
  for (const e of vocab) {
    if (seen.has(e.surface)) continue;
    seen.add(e.surface);
    out.push(e);
  }
  return out;
}

/**
 * Splits `text` into segments: a tappable one carries its `entry`, a plain one (particles,
 * punctuation, spaces, or any stretch not covered by `vocab`) has `entry: null`. Adjacent plain
 * characters are merged into one segment. Matching is longest-surface-first and non-overlapping;
 * if the same surface form legitimately occurs twice with different meanings, both occurrences
 * show the same (first-listed) entry — an accepted limitation for this reading-practice feature.
 */
export function segmentText(text: string, vocab: TopikVocabEntry[]): VocabSegment[] {
  if (text === "") return [];
  const entries = dedupeBySurface(vocab).filter((e) => e.surface.length > 0);
  if (entries.length === 0) return [{ text, entry: null }];
  const bySurface = new Map(entries.map((e) => [e.surface, e]));
  const candidates = [...bySurface.keys()].sort((a, b) => b.length - a.length);

  const segments: VocabSegment[] = [];
  let plain = "";
  let i = 0;
  const flushPlain = () => {
    if (plain !== "") {
      segments.push({ text: plain, entry: null });
      plain = "";
    }
  };
  while (i < text.length) {
    const match = candidates.find((s) => text.startsWith(s, i));
    if (match) {
      flushPlain();
      segments.push({ text: match, entry: bySurface.get(match)! });
      i += match.length;
    } else {
      plain += text[i];
      i++;
    }
  }
  flushPlain();
  return segments;
}
