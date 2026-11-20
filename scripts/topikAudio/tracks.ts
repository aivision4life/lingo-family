// M7.33 — planning a listening paper that arrives already split into one mp3 per question
// (`npm run topik-audio -- --tracks <dir>`), instead of as a single tape to be cut.
//
// Everything here is pure: the ffprobe/ffmpeg calls that fill `TrackProbe` live in run.ts.
//
// Why this exists next to `buildSegments`: when the publisher ships one file per question, the
// boundaries are already known exactly — they are the file joins — and `silencedetect` must not be
// asked where a question ends. The detector was wrong on all eight single-tape papers (see
// `estimateIntroEnd`), and a wrong boundary here would be invisible: the audio plays perfectly.
// So silence is used for one thing only, *inside* a file: where that file's own speech stops.
import type { Segment, Silence } from "./plan";

/** One source file of a pre-split paper, as ffprobe + silencedetect describe it. */
export type TrackProbe = {
  /** 1-based number read from the file name ("22 트랙 22.mp3" → 22). */
  number: number;
  file: string;
  /** Container duration (ms). This is the timeline `speechEndMs` was measured on. */
  durationMs: number;
  /**
   * frames × samples-per-frame ÷ sample rate (ms): the room the file takes in a stream-copy join.
   * It is ~150 ms longer than `durationMs` per file, because a decoder trims the encoder's delay
   * and padding using the LAME header and a joined tape keeps only the first file's header. Using
   * `durationMs` to place the joins drifts ~8 s over 51 files, which is half an answering gap.
   */
  frameMs: number;
  /** Start of this file's first pause of at least `--silence`: where its own speech stops. */
  speechEndMs: number | null;
  codec: string;
  sampleRate: number;
  channels: number;
};

/** A question in exam order, as the Word files describe it. */
export type TrackQuestion = { number: number; same_segment: boolean };

export type TrackPlan = {
  segments: Segment[];
  /** Where each track starts in the joined tape, ms; `offsetsMs[0]` is track 1 and always 0. */
  offsetsMs: number[];
  /** End of the spoken introduction = the whole of track 1. Never guessed from silence. */
  introEndMs: number;
  totalMs: number;
  /** `question.number` → the track number(s) its clip was cut from. */
  tracksOf: Map<number, number[]>;
};

export type TrackPlanResult = { ok: false; reasons: string[] } | ({ ok: true; warnings: string[] } & TrackPlan);

/**
 * The second question of a pair is announced in a second or two ("이십이 번"), then the file is
 * nothing but the answering gap. A file whose speech runs longer than this is not an announcement,
 * so the pairing read from the Word files disagrees with the files on disk — which is exactly the
 * mistake that must stop the run rather than be cut around.
 */
export const PAIR_ANNOUNCE_MAX_MS = 5_000;
/** How far a planned boundary may sit from the joined tape's own silence before the run stops. */
export const TRACK_DRIFT_MAX_MS = 500;

/** MPEG-1 layer III carries 1152 samples per frame, MPEG-2/2.5 half that. */
export function samplesPerFrame(sampleRate: number): number | null {
  if ([32_000, 44_100, 48_000].includes(sampleRate)) return 1152;
  if ([8_000, 11_025, 12_000, 16_000, 22_050, 24_000].includes(sampleRate)) return 576;
  return null;
}

/** "22 트랙 22.mp3" → 22. A name with no leading number is an error, never a guessed position. */
export function trackNumberFromName(fileName: string): { ok: true; number: number } | { ok: false; reason: string } {
  const m = /^(\d+)/.exec(fileName);
  if (!m) return { ok: false, reason: `${fileName}: the name does not start with a track number` };
  const number = Number(m[1]);
  if (!Number.isInteger(number) || number < 1) return { ok: false, reason: `${fileName}: track number ${m[1]} is not a positive integer` };
  return { ok: true, number };
}

/**
 * Matches the track files against the questions of one exam and lays them out on one tape.
 *
 * Track 1 is the spoken introduction and belongs to no question; track `n + 1` is question `n`.
 * A question the Word file marked as sharing the previous one's clip (`same_segment`, a pair from
 * question 21 on) adds its own file to the previous clip: `end_ms` stretches to the end of the
 * announcement file and `speech_end_ms` moves to the end of the announcement, which is the only
 * thing that tells the learner the second question has begun (the rule `mergeShortSegments` uses).
 *
 * Returns `ok: false` with every reason it found, and plans nothing: a paper whose files and Word
 * file disagree must be looked at, not cut.
 */
export function planTracks(args: {
  tracks: readonly TrackProbe[];
  questions: readonly TrackQuestion[];
  announceMaxMs?: number;
  /**
   * Where question 1's own audio starts **inside** the first question's file, ms.
   *
   * On 83회 track 2 is not question 1: it opens with "제83회 한국어능력시험…", the paper's spoken
   * introduction, and only then reads question 1. That mark is inside a file, so no file join gives
   * it, and nothing `silencedetect` measures separates a pause inside an introduction from the
   * pause before question 1 (M7.20) — it comes from a human who listened, via `--intro-in-track`.
   * 0 means "I listened: this file starts at question 1".
   */
  introInTrackMs: number;
}): TrackPlanResult {
  const announceMaxMs = args.announceMaxMs ?? PAIR_ANNOUNCE_MAX_MS;
  const tracks = [...args.tracks].sort((a, b) => a.number - b.number);
  const questions = [...args.questions].sort((a, b) => a.number - b.number);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (tracks.length === 0) return { ok: false, reasons: ["no track files found"] };
  if (!tracks.every((t, i) => t.number === i + 1))
    reasons.push(`track numbers do not run 1..${tracks.length} without a hole: ${tracks.map((t) => t.number).join(", ")}`);
  if (questions.length === 0) reasons.push("no questions found for this exam in the Word files");
  else if (!questions.every((q, i) => q.number === i + 1))
    reasons.push(`the Word file(s) cover questions ${questions[0]!.number}-${questions.at(-1)!.number}, which is not a run starting at 1`);
  if (questions.length > 0 && tracks.length !== questions.length + 1)
    reasons.push(`${tracks.length} track file(s) for ${questions.length} question(s): expected ${questions.length + 1} (track 1 is the introduction)`);

  const first = tracks[0]!;
  const perFrame = samplesPerFrame(first.sampleRate);
  if (perFrame === null) reasons.push(`sample rate ${first.sampleRate} Hz is not an mp3 rate this script can measure frames for`);
  for (const t of tracks.slice(1)) {
    if (t.codec !== first.codec || t.sampleRate !== first.sampleRate || t.channels !== first.channels)
      reasons.push(
        `track ${t.number} is ${t.codec} ${t.sampleRate} Hz ${t.channels}ch but track 1 is ${first.codec} ${first.sampleRate} Hz ${first.channels}ch` +
          ` — a stream-copy join needs one format`,
      );
  }

  // The second file of a pair must be short and hold only a short announcement.
  for (const [i, q] of questions.entries()) {
    const track = tracks[i + 1];
    if (!track) continue;
    if (q.same_segment && i === 0) {
      reasons.push(`question ${q.number} is marked as sharing the previous clip but is the first question of the paper`);
      continue;
    }
    if (track.speechEndMs === null) {
      reasons.push(`track ${track.number} (question ${q.number}) has no pause of at least --silence: its speech end cannot be measured`);
      continue;
    }
    if (q.same_segment) {
      const previous = tracks[i]!;
      if (track.speechEndMs > announceMaxMs)
        reasons.push(
          `track ${track.number} (question ${q.number}, second of a pair) speaks for ${(track.speechEndMs / 1000).toFixed(1)}s` +
            ` — more than the ${announceMaxMs / 1000}s an announcement takes, so the pairing does not match the files`,
        );
      if (track.durationMs >= previous.durationMs)
        reasons.push(
          `track ${track.number} (question ${q.number}, second of a pair) is ${(track.durationMs / 1000).toFixed(1)}s,` +
            ` not shorter than track ${previous.number}'s ${(previous.durationMs / 1000).toFixed(1)}s`,
        );
    } else if (track.speechEndMs <= announceMaxMs) {
      // Not an error: a real question could be this short. It is the shape of a mis-paired file.
      warnings.push(
        `track ${track.number} (question ${q.number}) speaks for only ${(track.speechEndMs / 1000).toFixed(1)}s` +
          ` although the Word file gives it a clip of its own`,
      );
    }
  }

  const firstQuestionTrack = tracks[1];
  if (args.introInTrackMs < 0) reasons.push(`--intro-in-track cannot be negative`);
  else if (firstQuestionTrack?.speechEndMs != null && args.introInTrackMs >= firstQuestionTrack.speechEndMs)
    reasons.push(
      `--intro-in-track ${(args.introInTrackMs / 1000).toFixed(3)}s is at or past where track ${firstQuestionTrack.number}'s speech stops` +
        ` (${(firstQuestionTrack.speechEndMs / 1000).toFixed(3)}s), so question 1 would have no audio`,
    );

  if (reasons.length > 0) return { ok: false, reasons };

  const offsetsMs: number[] = [];
  let cursor = 0;
  for (const t of tracks) {
    offsetsMs.push(cursor);
    cursor += t.frameMs;
  }
  const totalMs = cursor;
  // Track 1 whole, plus however much of the first question's file is still introduction.
  const introEndMs = (offsetsMs[1] ?? totalMs) + args.introInTrackMs;

  const segments: Segment[] = [];
  const tracksOf = new Map<number, number[]>();
  for (const [i, q] of questions.entries()) {
    const track = tracks[i + 1]!;
    // Only question 1's clip moves: every later boundary is still a file join.
    const start = offsetsMs[i + 1]! + (i === 0 ? args.introInTrackMs : 0);
    const end = offsetsMs[i + 2] ?? totalMs;
    // Measured inside the file, so always from the file's own offset — never from the moved start.
    const speechEnd = offsetsMs[i + 1]! + track.speechEndMs!;
    const previous = segments.at(-1);
    if (q.same_segment && previous) {
      previous.end_ms = end;
      previous.speech_end_ms = speechEnd;
      tracksOf.set(q.number, [track.number]);
      const sharedWith = questions[i - 1]!.number;
      tracksOf.set(sharedWith, [...(tracksOf.get(sharedWith) ?? []), track.number]);
      continue;
    }
    segments.push({ idx: segments.length + 1, start_ms: start, speech_end_ms: speechEnd, end_ms: end });
    tracksOf.set(q.number, [track.number]);
  }

  return { ok: true, warnings, segments, offsetsMs, introEndMs, totalMs, tracksOf };
}

/** A pause inside the first question's file that a human might choose as the end of the introduction. */
export type IntroCandidate = { markMs: number; pauseMs: number };

/**
 * The pauses to offer when `--intro-in-track` is missing. It proposes nothing on its own.
 *
 * This is deliberately not an estimate. `estimateIntroEnd` exists for the single-tape path because
 * there the whole paper hangs on one mark; here the mark moves one clip only, every other boundary
 * being a file join, so the honest answer is a short list of the real pauses with a sample cut at
 * each. The longest pauses come first because that is how they are chosen, but the list is returned
 * in file order so the samples can be numbered the way a person listens to them.
 */
export function introCandidates(args: { silences: readonly Silence[]; speechEndMs: number; minPauseMs?: number; max?: number }): IntroCandidate[] {
  const minPauseMs = args.minPauseMs ?? 1_000;
  return args.silences
    .filter((s) => s.end_ms < args.speechEndMs && s.start_ms > 0 && s.end_ms - s.start_ms >= minPauseMs)
    .map((s) => ({ markMs: s.end_ms, pauseMs: s.end_ms - s.start_ms }))
    .sort((a, b) => b.pauseMs - a.pauseMs)
    .slice(0, args.max ?? 4)
    .sort((a, b) => a.markMs - b.markMs);
}

/** One clip checked against the tape that was actually written. */
export type BoundaryCheck = {
  idx: number;
  /** Nearest long silence start minus the planned speech end. Positive = the plan stops too early. */
  driftMs: number | null;
  /**
   * Whether a long silence covers the clip's start, i.e. the join landed in an answering gap.
   *
   * It is meaningless for clip 1, whose start is the end of the introduction: the pause there is
   * the introduction's own, and on 83회 it is 3.5 s — shorter than `--silence` and nothing like an
   * answering gap. `appliesToStart` says so rather than letting clip 1 fail every paper.
   */
  startInSilence: boolean;
  appliesToStart: boolean;
};

/**
 * Checks the plan against the joined tape instead of trusting the arithmetic.
 *
 * The boundaries come from the file joins and are never moved by this. What it answers is whether
 * the joins landed where the frame maths said they would: every clip's speech end should sit at the
 * start of a long silence, and every clip's start should sit inside one. A frame-count mistake
 * would shift everything after it while still playing normal audio, so it has to be measured once
 * on the real file rather than reasoned about.
 */
export function verifyTrackBoundaries(args: { segments: readonly Segment[]; silences: readonly Silence[]; minSilenceMs: number }): BoundaryCheck[] {
  const long = args.silences.filter((s) => s.end_ms - s.start_ms >= args.minSilenceMs);
  return args.segments.map((s) => {
    let driftMs: number | null = null;
    for (const sil of long) {
      const d = sil.start_ms - s.speech_end_ms;
      if (driftMs === null || Math.abs(d) < Math.abs(driftMs)) driftMs = d;
    }
    return {
      idx: s.idx,
      driftMs,
      startInSilence: long.some((sil) => sil.start_ms <= s.start_ms && sil.end_ms >= s.start_ms),
      appliesToStart: s.idx > 1,
    };
  });
}
