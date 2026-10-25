// Pure rules for the listening-clip editor (M7.1): what a set of boundaries must look like before
// an adult may approve it, and how a typed timestamp becomes milliseconds.
import type { TopikSegment } from "@shared/topik";

/** "01:42.487", "1:42.4", "102.487" or "102" → ms; null when it is not a time at all. */
export function parseTimeInput(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return null;
  // With minutes the seconds must be 0-59 ("1:75" is a typo, not 2:15); without them any number of
  // seconds is fine, which is how the dry-run report's raw values can be pasted straight in.
  const withMinutes = /^(\d+):([0-5]?\d(?:\.\d{1,3})?)$/.exec(trimmed);
  if (withMinutes) return Math.round((Number(withMinutes[1]) * 60 + Number(withMinutes[2])) * 1000);
  const seconds = /^\d+(?:\.\d{1,3})?$/.exec(trimmed);
  return seconds ? Math.round(Number(seconds[0]) * 1000) : null;
}

/** The inverse, as the editor's inputs show it. */
export function formatTimeInput(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}

/** Typed so the i18n key `topik.audio.problem.<code>` can be checked at compile time. */
export type SegmentProblemCode = "startsAfterEnd" | "speechOutside" | "pastFile" | "noQuestion" | "overlapsNext" | "gapToNext";
export type SegmentProblem = { segmentId: string; message: SegmentProblemCode };

/**
 * Everything wrong with a set of clips, in the order they are shown.
 *
 * These are the mistakes that are invisible while listening: a clip that overlaps the next one, or
 * a gap between two clips, still plays audio that sounds perfectly fine — what goes wrong is that
 * the learner hears the wrong part of the paper, which only shows up as answers that stop making
 * sense. The review screen refuses approval while any of them stands.
 */
export function segmentProblems(segments: readonly TopikSegment[], durationMs: number): SegmentProblem[] {
  const problems: SegmentProblem[] = [];
  const ordered = [...segments].sort((a, b) => a.idx - b.idx);

  for (const [i, s] of ordered.entries()) {
    const at = (message: SegmentProblemCode) => problems.push({ segmentId: s.id, message });
    if (s.start_ms >= s.end_ms) at("startsAfterEnd");
    if (s.speech_end_ms < s.start_ms || s.speech_end_ms > s.end_ms) at("speechOutside");
    if (s.end_ms > durationMs) at("pastFile");
    if (s.questions.length === 0) at("noQuestion");

    const next = ordered[i + 1];
    if (next && s.end_ms > next.start_ms) at("overlapsNext");
    if (next && s.end_ms < next.start_ms) at("gapToNext");
  }
  return problems;
}

/** A clip may be approved only when nothing is wrong with any of them. */
export const canApprove = (segments: readonly TopikSegment[], durationMs: number) =>
  segments.length > 0 && segmentProblems(segments, durationMs).length === 0;

/**
 * Where "play this clip" should stop in practice: at the end of the talking plus a short pause, so
 * a paper that leaves 18 seconds for answering does not play 18 seconds of silence. The real
 * boundary is kept in the data for the timed mock test, which must replay the paper's own pacing.
 */
export const PRACTICE_TAIL_MS = 5_000;
export const practiceEnd = (s: Pick<TopikSegment, "speech_end_ms" | "end_ms">) => Math.min(s.speech_end_ms + PRACTICE_TAIL_MS, s.end_ms);
