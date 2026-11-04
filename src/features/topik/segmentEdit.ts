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
export type SegmentProblemCode = "startsAfterEnd" | "speechOutside" | "pastFile" | "overlapsNext" | "gapToNext";
export type SegmentProblem = { segmentId: string; message: SegmentProblemCode };

/**
 * Everything wrong with a set of clips, in the order they are shown.
 *
 * These are the mistakes that are invisible while listening: a clip that overlaps the next one, or
 * a gap between two clips, still plays audio that sounds perfectly fine — what goes wrong is that
 * the learner hears the wrong part of the paper, which only shows up as answers that stop making
 * sense. The review screen refuses approval while any of them stands.
 *
 * A clip with no question attached is deliberately *not* here: approving a paper means "these
 * timestamps are right", not "this paper is complete". A paper whose questions have only been typed
 * up as far as number 12 still has 36 clips, and must be usable for practising those 12 — the
 * session query already picks only questions that have a clip, so the rest simply wait.
 */
export function segmentProblems(segments: readonly TopikSegment[], durationMs: number): SegmentProblem[] {
  const problems: SegmentProblem[] = [];
  const ordered = [...segments].sort((a, b) => a.idx - b.idx);

  for (const [i, s] of ordered.entries()) {
    const at = (message: SegmentProblemCode) => problems.push({ segmentId: s.id, message });
    if (s.start_ms >= s.end_ms) at("startsAfterEnd");
    if (s.speech_end_ms < s.start_ms || s.speech_end_ms > s.end_ms) at("speechOutside");
    if (s.end_ms > durationMs) at("pastFile");

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
 *
 * One tail for every clip, including the pairs. From question 21 the narrator announces the second
 * question — "이십이 번" — after the first one's ~20 second answer pause, and the detector that
 * wrote `speech_end_ms` used to skip that one-second announcement as too short to be speech: the
 * announcement then fell outside this window and the second question was never announced at all.
 * That was a fault in the data, fixed in the data (`mergeShortSegments` + `npm run
 * topik-speech-end`, M7.6), so the rule here stays the simple one — a longer tail would only add
 * dead air, since playback stopping does not stop the learner thinking.
 */
export const PRACTICE_TAIL_MS = 5_000;
export const practiceEnd = (s: Pick<TopikSegment, "speech_end_ms" | "end_ms">) =>
  Math.min(s.speech_end_ms + PRACTICE_TAIL_MS, s.end_ms);

/** `m:ss.s` — one decimal, which is as precise as a boundary can be judged by ear. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 100) * 100);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${Math.floor((total % 1000) / 100)}`;
}

/** The numbers the review table shows for one clip, all derived — nothing is stored twice. */
export type SegmentMetrics = {
  /** How long the clip runs in total. */
  lengthMs: number;
  /** The silence left for choosing an answer: from the end of the talking to the end of the clip. */
  pauseMs: number;
};

export const metricsOf = (s: Pick<TopikSegment, "start_ms" | "speech_end_ms" | "end_ms">): SegmentMetrics => ({
  lengthMs: Math.max(0, s.end_ms - s.start_ms),
  pauseMs: Math.max(0, s.end_ms - s.speech_end_ms),
});

/**
 * A real TOPIK II listening paper leaves this much silence after each question for choosing an
 * answer. Less than that and the clip was almost certainly cut before the paper's own pause ended.
 */
export const SHORT_PAUSE_MS = 3_000;
/** A clip this much shorter than its neighbours is suspicious rather than merely short. */
export const SHORT_CLIP_RATIO = 0.5;
/** Below this many clips a median says nothing, so length is not judged at all. */
export const MIN_SEGMENTS_FOR_MEDIAN = 3;
/**
 * A clip's length is compared against the median of this many clips around it, not against the
 * whole paper's.
 *
 * A real TOPIK II listening paper is not uniform: questions 1-20 are single short exchanges (~30-70
 * s) while 21-36 are dialogues and lectures (~2.5-3.5 min, two questions per clip). One median over
 * all of them lands between the two groups, which gets it exactly backwards — on the real 35회 paper
 * it flagged a perfectly normal 28-second question 5, and a 70-second clip in the lecture section,
 * which really would be half a question, would have passed. Comparing with the neighbours follows
 * whichever section a clip is in without needing to know the paper's structure.
 */
export const LOCAL_WINDOW = 9;

/**
 * Typed so the i18n key `topik.audio.warning.<code>` can be checked at compile time.
 *
 *  - `shortPause`: no time to answer — the clip probably ends inside the paper's pause;
 *  - `shortClip`: far shorter than the other clips of the same paper, so ffmpeg most likely split
 *    one question in two at a pause inside the dialogue;
 *  - `shortLastClip`: the same, but it is the last clip — usually the closing announcement
 *    ("시험이 끝났습니다"), which is not a question at all and should be deleted rather than fixed;
 *  - `noQuestion`: nothing is asked about this clip yet, which is normal while a paper's questions
 *    are still being typed up — information, never a reason to hold up the whole paper.
 */
export type SegmentWarningCode = "shortPause" | "shortClip" | "shortLastClip" | "noQuestion";
export type SegmentWarning = { segmentId: string; code: SegmentWarningCode };

/** The middle value of a sorted copy; the average would be dragged by the very outliers we hunt. */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Everything that merely *looks* wrong about a set of clips — unlike `segmentProblems`, none of
 * these blocks approval. They exist so 36 clips can be checked by eye instead of by listening to
 * each one: the three shapes below are what a mis-split paper actually looks like in the numbers.
 */
export function segmentWarnings(segments: readonly TopikSegment[]): SegmentWarning[] {
  const ordered = [...segments].sort((a, b) => a.idx - b.idx);
  const lengths = ordered.map((s) => metricsOf(s).lengthMs);
  const half = Math.floor(LOCAL_WINDOW / 2);

  const warnings: SegmentWarning[] = [];
  for (const [i, s] of ordered.entries()) {
    const { lengthMs, pauseMs } = metricsOf(s);
    if (s.questions.length === 0) warnings.push({ segmentId: s.id, code: "noQuestion" });
    if (pauseMs < SHORT_PAUSE_MS) warnings.push({ segmentId: s.id, code: "shortPause" });

    const neighbours = lengths.slice(Math.max(0, i - half), i + half + 1);
    const median = medianOf(neighbours);
    if (neighbours.length < MIN_SEGMENTS_FOR_MEDIAN || median <= 0) continue;
    if (lengthMs >= median * SHORT_CLIP_RATIO) continue;
    // One code, not both: the last clip being short has its own, likelier explanation.
    warnings.push({ segmentId: s.id, code: i === ordered.length - 1 ? "shortLastClip" : "shortClip" });
  }
  return warnings;
}

/** How much of a clip to play for each of the two quick checks (M7.2). */
export const PREVIEW_HEAD_MS = 5_000;
export const PREVIEW_TAIL_MS = 10_000;

/** The first seconds: does the clip start on the question's own opening, or mid-sentence? */
export const headPreview = (s: Pick<TopikSegment, "start_ms" | "end_ms">) => ({
  from: s.start_ms,
  to: Math.min(s.start_ms + PREVIEW_HEAD_MS, s.end_ms),
});

/**
 * The last seconds *of the talking*, not of the clip: a correct clip ends with a long designed
 * silence, so playing its final seconds would prove nothing. What can go wrong is a cut through the
 * last sentence, and that is heard right before `speech_end_ms`.
 */
export const tailPreview = (s: Pick<TopikSegment, "start_ms" | "speech_end_ms">) => ({
  from: Math.max(s.start_ms, s.speech_end_ms - PREVIEW_TAIL_MS),
  to: s.speech_end_ms,
});

/** Where the playing head is inside a clip, as 0…1 for the progress bar. */
export function clipProgress(positionMs: number, startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  return Math.min(1, Math.max(0, (positionMs - startMs) / (endMs - startMs)));
}
