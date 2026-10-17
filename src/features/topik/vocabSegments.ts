// Splits a TOPIK question's text into tappable/non-tappable spans (M6.2). Korean attaches grammar
// endings without a space (e.g. "학교에서" = 학교 + 에서), so a whitespace split cannot tell which
// part was tapped — instead, each AI-found `surface` form is matched as an exact substring,
// longest-match-first, and whatever is left over (particles, punctuation, spaces) is not tappable.
import { isGrammarPos, splitUnderline, type TopikVocabEntry } from "@shared/topik";

export type VocabSegment = { text: string; entry: TopikVocabEntry | null };

/** Re-exported under this feature's own name for existing call sites; see `isGrammarPos`. */
export const isGrammarEntry = isGrammarPos;

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

export type UnderlineTappableSegment = VocabSegment & { underlined: boolean };

/**
 * Combines the two independent annotation layers this stem can carry — which words are tappable
 * (`vocab`) and which phrase is underlined (`<u>…</u>`, M6.5-ish, only in a question's stem) —
 * since they can overlap in either direction: a tappable word can sit fully inside, fully outside,
 * or straddle the edge of the underlined phrase.
 *
 * A tappable segment is never split mid-word to follow the underline boundary exactly: `TopikWordTap`
 * always renders its entry's full `surface`, so cutting one in two would show that surface text
 * twice. Instead a tappable segment is underlined as a whole as soon as ANY of its characters fall
 * inside the underlined phrase — tapping it keeps working either way, inside or outside, or
 * straddling the boundary. A non-tappable (plain) segment has no such constraint and is split
 * exactly at the boundary, so the visible underline itself still lines up precisely.
 */
export function segmentTextWithUnderline(text: string, vocab: TopikVocabEntry[]): UnderlineTappableSegment[] {
  const underlineRuns = splitUnderline(text);
  const plainText = underlineRuns.map((r) => r.text).join("");
  const vocabSegs = segmentText(plainText, vocab);

  const out: UnderlineTappableSegment[] = [];
  let runIndex = 0;
  let runOffset = 0;
  for (const seg of vocabSegs) {
    if (seg.entry) {
      let remaining = seg.text.length;
      let underlined = false;
      let idx = runIndex;
      let offset = runOffset;
      while (remaining > 0) {
        const run = underlineRuns[idx]!;
        const take = Math.min(run.text.length - offset, remaining);
        if (run.underlined) underlined = true;
        remaining -= take;
        offset += take;
        if (offset >= run.text.length) {
          idx++;
          offset = 0;
        }
      }
      out.push({ text: seg.text, entry: seg.entry, underlined });
      runIndex = idx;
      runOffset = offset;
    } else {
      let consumed = 0;
      while (consumed < seg.text.length) {
        const run = underlineRuns[runIndex]!;
        const take = Math.min(run.text.length - runOffset, seg.text.length - consumed);
        out.push({ text: seg.text.slice(consumed, consumed + take), entry: null, underlined: run.underlined });
        consumed += take;
        runOffset += take;
        if (runOffset >= run.text.length) {
          runIndex++;
          runOffset = 0;
        }
      }
    }
  }
  return out;
}
