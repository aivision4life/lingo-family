// Pure, unit-tested parts of `npm run topik-audio` (M7.1): turning ffmpeg's silence report into
// segment boundaries, and deciding whether those boundaries may be trusted enough to assign
// questions to them. No file, network or D1 access here — see run.ts for that.

/** One silence as `silencedetect` reports it. */
export type Silence = { start_ms: number; end_ms: number };

/** One proposed clip. See db/schema.ts `topik_segments` for what the three timestamps mean. */
export type Segment = { idx: number; start_ms: number; speech_end_ms: number; end_ms: number };

const toMs = (seconds: string) => Math.round(Number(seconds) * 1000);

/**
 * Reads `ffmpeg -af silencedetect` output. It prints one line when a silence starts and another
 * when it ends; the final silence of a file may never get its "end" line, so an unterminated
 * silence runs to the end of the file.
 */
export function parseSilenceLog(log: string, durationMs: number): Silence[] {
  const silences: Silence[] = [];
  let openStart: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      openStart = Math.max(0, toMs(start[1]!));
      continue;
    }
    const end = /silence_end:\s*([\d.]+)/.exec(line);
    if (end && openStart !== null) {
      silences.push({ start_ms: openStart, end_ms: Math.min(toMs(end[1]!), durationMs) });
      openStart = null;
    }
  }
  if (openStart !== null) silences.push({ start_ms: openStart, end_ms: durationMs });
  return silences;
}

/**
 * Turns silences into segments.
 *
 * The gap after a clip belongs to that clip, not to the next one: a segment ends where the next
 * segment's *speech* starts, so nothing is thrown away and the timed mock test can replay the
 * paper's own pacing. `speech_end_ms` marks where the talking actually stopped, which is what
 * self-paced practice plays to.
 *
 * Everything before the first clip — the paper's spoken introduction and the pause after it — is
 * dropped: it belongs to no question. `introEndMs` is where the first clip's speech begins, and it
 * always comes from a human (`--intro`): see `estimateIntroEnd` for why nothing in the signal can
 * decide it.
 */
export function buildSegments(silences: readonly Silence[], durationMs: number, introEndMs: number): Segment[] {
  // Only the gaps that fall after the introduction separate one clip from the next.
  const gaps = silences.filter((s) => s.start_ms > introEndMs).sort((a, b) => a.start_ms - b.start_ms);
  const segments: Segment[] = [];
  let start = introEndMs;
  for (const gap of gaps) {
    // A silence that runs to the end of the file is trailing quiet, not a boundary.
    if (gap.end_ms >= durationMs) break;
    segments.push({ idx: segments.length + 1, start_ms: start, speech_end_ms: gap.start_ms, end_ms: gap.end_ms });
    start = gap.end_ms;
  }
  const lastGap = gaps.at(-1);
  const trailing = lastGap && lastGap.end_ms >= durationMs ? lastGap.start_ms : durationMs;
  if (start < durationMs) segments.push({ idx: segments.length + 1, start_ms: start, speech_end_ms: trailing, end_ms: durationMs });
  return segments;
}

/**
 * Only the pauses long enough to separate two clips. A listening paper pauses constantly *inside* a
 * dialogue (speaker turns, ~1-2s) and then much longer after each question (~15-18s), so the two
 * populations sit far apart and any threshold in the empty band between them gives the same answer.
 * `silenceHistogram` prints that band, so a wrong threshold is visible instead of being guessed at.
 */
export const boundarySilences = (silences: readonly Silence[], minMs: number): Silence[] =>
  silences.filter((s) => s.end_ms - s.start_ms >= minMs);

/**
 * Why there is no `pickIntroEnd` any more (M7.20).
 *
 * There used to be one: "the end of the first pause of at least 0.8s in the opening two minutes".
 * It was wrong on **all eight** real papers, by 26 to 62 seconds, in four different ways (a pause
 * inside the introduction, silence at the very start of the file, background music covering every
 * pause, and music covering them while a short gap still existed). Each failure was patched by
 * widening a threshold, and the next paper broke it again.
 *
 * The reason is not a badly chosen threshold. On five of the eight papers the introduction is
 * ordinary speech with ordinary pauses, and **a pause inside the introduction is indistinguishable
 * from the pause before question 1** by anything `silencedetect` measures: 35회 has 21 silences in
 * its first 100 seconds, the longest 12.3s, and the real mark is at 81.0s. No duration rule
 * separates them, because the difference is in the *meaning* of the words on either side. A problem
 * with no automatic solution is answered by saying so, not by guessing better: the mark is now
 * always `--intro`, from a human who listened.
 *
 * What a machine *can* do is propose a number that carries its own check, which is what the
 * function below is for. It never decides anything.
 */

/** A paper's narration speed is measured in Hangul syllables; everything else is punctuation. */
export const countHangul = (text: string | null | undefined): number => (text ?? "").match(/[가-힣]/g)?.length ?? 0;

/** How much later the estimate lands than the mark a human picks, measured on all eight papers. */
export const INTRO_BIAS_MS = 1_400;
/** How far from the estimate a real silence may be and still be the mark it was pointing at. */
export const INTRO_SNAP_MS = 5_000;
/** A silence this early is the file's own leading quiet, never a structural mark (64회). */
const LEADING_QUIET_MS = 500;

export type IntroEstimate =
  | {
      ok: true;
      /** The mark to offer, snapped onto a real silence boundary. */
      suggested_ms: number;
      /** Before snapping and before `INTRO_BIAS_MS`, for the report to show its own arithmetic. */
      raw_ms: number;
      /** Syllables per second, measured on clips 2 and 3 of this very paper. */
      rate: number;
      /** How long clip 1 would be if the suggestion is right — the number that self-checks. */
      clip1_ms: number;
      /** Where clip 1's speech stops; the one anchor taken straight from the signal. */
      speech_end1_ms: number;
    }
  | { ok: false; reason: string };

/**
 * Proposes where the introduction ends, by reading speed rather than by silence.
 *
 * Clips 2 and 3 are a ruler the paper made itself: their boundaries come from the ~12-second answer
 * gaps, which do not depend on the introduction at all. Their syllables over their seconds give
 * this narrator's pace, and question 1's own syllable count then says how long clip 1 must be — so
 * `speech_end(clip 1) − that length` is where clip 1 began.
 *
 * Measured against the eight marks a human approved: inside 4 **milliseconds** on all eight, once
 * `INTRO_BIAS_MS` is taken off and the result is snapped onto the nearest real silence boundary
 * (the human was choosing a silence boundary too). Without snapping it is 0.6-2.0s late.
 *
 * That accuracy is not a licence to cut automatically, and the caller must not use it that way.
 * The point is that the proposal arrives with `clip1_ms` beside it: "clip 1 would be 16s, the text
 * needs 16s" is checkable, and "clip 1 would be 56s" is what gave away every one of the eight
 * failures. The estimate is printed, a 14-second sample is cut at it, and a human still types it in.
 *
 * Assumes no silence of `boundaryMs` or longer sits before the real mark — true on all eight papers
 * (the first such gap is always question 1's own answer gap), and a paper that breaks it shows a
 * nonsense `clip1_ms` rather than a plausible mark.
 *
 * Counts the instruction's syllables in all three questions although the audio reads it once per
 * block: counted consistently, the error cancels, and of the three variants tried this was the one
 * with the smallest spread (the other two were 2-4s out, see SPEC §11 M7.20).
 */
export function estimateIntroEnd(
  silences: readonly Silence[],
  boundaryMs: number,
  /** Syllables of questions 1, 2 and 3 (instruction + transcript), in that order. */
  syllables: readonly number[],
): IntroEstimate {
  if (syllables.length < 3 || syllables.slice(0, 3).some((n) => n <= 0))
    return { ok: false, reason: "needs questions 1-3 of this exam in data/topik/ to measure reading speed" };
  const gaps = boundarySilences(
    silences.filter((s) => s.start_ms > LEADING_QUIET_MS),
    boundaryMs,
  ).sort((a, b) => a.start_ms - b.start_ms);
  if (gaps.length < 3) return { ok: false, reason: `only ${gaps.length} answer gap(s) found — too few to measure reading speed` };
  const [g1, g2, g3] = gaps as [Silence, Silence, Silence];
  const rulerMs = g2.start_ms - g1.end_ms + (g3.start_ms - g2.end_ms);
  if (rulerMs <= 0) return { ok: false, reason: "clips 2 and 3 came out empty — the gap threshold is wrong for this paper" };
  const rate = ((syllables[1]! + syllables[2]!) / rulerMs) * 1000;
  const rawMs = g1.start_ms - (syllables[0]! / rate) * 1000;
  if (rawMs <= 0) return { ok: false, reason: "question 1's text is longer than the audio before its answer gap" };
  const target = rawMs - INTRO_BIAS_MS;
  const near = silences
    .filter((s) => s.start_ms > LEADING_QUIET_MS && Math.abs(s.end_ms - target) <= INTRO_SNAP_MS)
    .sort((a, b) => Math.abs(a.end_ms - target) - Math.abs(b.end_ms - target));
  const suggested = Math.round(near[0]?.end_ms ?? target);
  return {
    ok: true,
    suggested_ms: suggested,
    raw_ms: Math.round(rawMs),
    rate,
    clip1_ms: g1.start_ms - suggested,
    speech_end1_ms: g1.start_ms,
  };
}

/** The silences a human can choose from instead, when the sample says the suggestion is off. */
export const silencesNear = (silences: readonly Silence[], markMs: number, windowMs: number): Silence[] =>
  silences
    .filter((s) => s.start_ms > LEADING_QUIET_MS && Math.abs(s.end_ms - markMs) <= windowMs)
    .sort((a, b) => a.start_ms - b.start_ms);

/** Counts silences per duration band, for the report: the threshold should land in an empty band. */
export function silenceHistogram(silences: readonly Silence[]): { label: string; count: number }[] {
  const bands = [1, 2, 3, 5, 8, 12, 20];
  const durations = silences.map((s) => s.end_ms - s.start_ms);
  const rows = bands.map((upper, i) => ({
    label: `${i === 0 ? "0" : bands[i - 1]}-${upper}s`,
    count: durations.filter((d) => d >= (i === 0 ? 0 : bands[i - 1]!) * 1000 && d < upper * 1000).length,
  }));
  rows.push({ label: "≥20s", count: durations.filter((d) => d >= 20_000).length });
  return rows;
}

/**
 * Folds "clips" that are only a second of speech into the clip before them.
 *
 * In a real paper the second question of a pair (21-22, 23-24 … 49-50) is introduced by the
 * narrator saying just its number, which lands between two answer gaps and therefore looks like a
 * clip of its own: the first measured paper produced exactly 15 of them, all ≈1s, against 35 real
 * clips of 14s or more. Replaying "오십 번" to a learner is useless — both questions of a pair are
 * asked about the same dialogue.
 *
 * The merged clip keeps the dialogue's own `start_ms`, while `end_ms` stretches to where the next
 * real clip begins (what the timed mock test needs) and **`speech_end_ms` moves to the end of the
 * announcement** — because the announcement is talking, and it is the only thing that tells the
 * learner question 22 has begun (M7.6).
 *
 * Keeping the dialogue's own `speech_end_ms` here was the original rule, and it was wrong: practice
 * plays to `speech_end_ms + 5s`, so every pair stopped ~15 seconds before "이십이 번" was said and
 * the second question was never announced at all. Measured on 35회: all 15 pair clips, none of the
 * 20 single ones. The merge is always reported, and the exam stays unverified.
 */
export function mergeShortSegments(segments: readonly Segment[], minSpeechMs: number): { segments: Segment[]; merged: number } {
  const out: Segment[] = [];
  let merged = 0;
  for (const s of segments) {
    const previous = out.at(-1);
    // A short *first* segment has nothing to merge into; it is kept so it surfaces as a mismatch.
    if (previous && s.speech_end_ms - s.start_ms < minSpeechMs) {
      previous.end_ms = s.end_ms;
      previous.speech_end_ms = s.speech_end_ms;
      merged += 1;
      continue;
    }
    out.push({ ...s, idx: out.length + 1 });
  }
  return { segments: out, merged };
}

/**
 * Where the talking really stops inside an existing clip: the end of the **last** speech run in
 * `[start_ms, end_ms)`, however short it is (M7.6).
 *
 * Used to repair clips that were cut before `mergeShortSegments` carried the announcement's
 * `speech_end_ms` over. It works from the clip's own boundaries rather than re-cutting the file,
 * so boundaries a human has reviewed and adjusted by hand are never touched.
 *
 * Returns null when the clip holds no speech at all (a silence-only clip, which should not exist)
 * — the caller leaves such a clip alone rather than guessing.
 */
export function lastSpeechEnd(silences: readonly Silence[], startMs: number, endMs: number): number | null {
  // Silence inside the clip, clipped to it: the gaps between these are the speech.
  const inside = silences
    .map((s) => ({ start_ms: Math.max(s.start_ms, startMs), end_ms: Math.min(s.end_ms, endMs) }))
    .filter((s) => s.end_ms > s.start_ms && s.start_ms < endMs && s.end_ms > startMs)
    .sort((a, b) => a.start_ms - b.start_ms);

  let speechEnd: number | null = null;
  let cursor = startMs;
  for (const silence of inside) {
    if (silence.start_ms > cursor) speechEnd = silence.start_ms;
    cursor = Math.max(cursor, silence.end_ms);
  }
  // Speech that runs to the clip's own end (no trailing silence).
  if (endMs > cursor) speechEnd = endMs;
  return speechEnd;
}

/**
 * How many clips a set of questions needs: one per question, minus the ones the Word file marked
 * as sharing the previous question's clip. Questions must be in exam order.
 */
export function expectedSegmentCount(questions: readonly { number: number; same_segment: boolean }[]): number {
  const ordered = [...questions].sort((a, b) => a.number - b.number);
  // A "shares the previous one" mark on the very first question has nothing to share with; count
  // it as its own clip rather than silently dropping a segment the audio really does contain.
  return ordered.filter((q, i) => i === 0 || !q.same_segment).length;
}

export type AudioPlan = {
  segments: Segment[];
  /** `question.number` → 1-based segment index, empty when nothing could safely be assigned. */
  assignment: Map<number, number>;
  expected: number;
  /** "full" = the Word files cover the whole paper, "partial" = questions 1..n of it. */
  coverage: "none" | "partial" | "full";
  problems: string[];
};

/**
 * Matches proposed segments against the questions of one exam.
 *
 * Questions may cover only the start of the paper — handy while trying the workflow out on a few
 * questions before typing up all fifty — and then the clips they need are taken from the front and
 * the rest are left unassigned.
 *
 * What is never allowed is assigning when the question numbers do not run 1, 2, 3 … without a
 * hole. Starting mid-paper ("21~22") says nothing about which clip question 21 belongs to, and a
 * question missing from the middle shifts every question after it onto the wrong clip. Both would
 * still play perfectly normal audio — unlike a missing file, the mistake surfaces only as answers
 * that slowly stop making sense — so the exam stays unassigned and unverified until a human looks.
 */
export function planAudio(
  segments: Segment[],
  questions: readonly { number: number; same_segment: boolean }[],
  durationMs: number,
): AudioPlan {
  const expected = expectedSegmentCount(questions);
  const problems: string[] = [];
  for (const s of segments) {
    if (s.start_ms >= s.end_ms) problems.push(`segment ${s.idx}: starts at or after it ends`);
    else if (s.speech_end_ms < s.start_ms || s.speech_end_ms > s.end_ms) problems.push(`segment ${s.idx}: speech end outside the segment`);
    if (s.end_ms > durationMs) problems.push(`segment ${s.idx}: ends past the end of the file`);
  }

  const ordered = [...questions].sort((a, b) => a.number - b.number);
  const fromQuestionOne = ordered.length > 0 && ordered.every((q, i) => q.number === i + 1);
  const assignment = new Map<number, number>();
  let coverage: AudioPlan["coverage"] = "none";

  if (ordered.length === 0) {
    problems.push("no questions found for this exam in the Word files — nothing was assigned");
  } else if (!fromQuestionOne) {
    problems.push(
      `the Word file(s) cover questions ${ordered[0]!.number}-${ordered.at(-1)!.number}, which is not a run starting at 1` +
        ` — nothing was assigned, because there is no way to tell which clip the first of them belongs to`,
    );
  } else if (expected > segments.length) {
    problems.push(`the Word file(s) expect ${expected} clip(s) but only ${segments.length} were found — nothing was assigned`);
  } else {
    let idx = 0;
    for (const [i, q] of ordered.entries()) {
      if (i === 0 || !q.same_segment) idx += 1;
      assignment.set(q.number, idx);
    }
    coverage = expected === segments.length ? "full" : "partial";
  }

  return { segments, assignment, expected, coverage, problems };
}

/** "01:02.340" — how timestamps are shown in the report and the review screen. */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}

/**
 * The one place a file name becomes an exam label (M7.1).
 *
 * File names stay ASCII — Korean in a file name has been mangled by one toolchain or another on
 * every platform at some point — while exam labels stay Korean, matching the reading section and
 * the Heading 2 the questions themselves carry. So the round travels as `Test35` in the file name
 * and becomes `35회` here: `TOPIK_Listening_OfficialTest_Test35.mp3` → `OfficialTest-35회`.
 *
 * A name that does not carry a `Test<N>` token is an **error**, never a quiet fallback to the
 * `연습N` group counter. A silent fallback is exactly what mislabelled a whole import once before
 * (see the "exam label" lesson in CLAUDE.md): everything still looked fine, and the damage only
 * showed up much later as questions attached to the wrong exam.
 */
export type ExamNameResult = { ok: true; exam: string } | { ok: false; reason: string };

const AUDIO_FILE_NAME = /^TOPIK_Listening_(.+)_([^_]+)\.mp3$/i;
const ROUND_TOKEN = /^Test(\d+)$/i;

export function examFromAudioName(fileName: string): ExamNameResult {
  const m = AUDIO_FILE_NAME.exec(fileName);
  if (!m) return { ok: false, reason: 'name does not match "TOPIK_Listening_<source>_Test<N>.mp3"' };

  const [, source, roundToken] = m;
  const round = ROUND_TOKEN.exec(roundToken!);
  if (!round) {
    return {
      ok: false,
      reason: `the round part of the name is "${roundToken}", which is not "Test<N>" — rename the file (e.g. ..._Test35.mp3) instead of letting it be guessed`,
    };
  }
  // "Test01" and "Test1" are the same round; the label never keeps a leading zero.
  return { ok: true, exam: `${source}-${Number(round[1])}회` };
}

/** One question that `--link-only` would attach to a clip that already exists. */
export type LinkTarget = { number: number; segmentIdx: number; shared: boolean };
export type LinkPlan =
  | { ok: true; links: LinkTarget[]; unusedSegments: number[]; notImported: number[] }
  | { ok: false; reasons: string[] };

/**
 * Attaches questions to clips that are already cut and already approved (`--link-only`).
 *
 * The normal path cuts an exam's audio and links everything in one go, but a paper is typed up a
 * few questions at a time: the clips for questions 13-20 exist and have been checked by hand, and
 * only the newly imported questions need pointing at them. Re-cutting to achieve that would delete
 * the segments, null every existing link and throw away the approval — all to change a foreign key.
 *
 * A clip's ordinal is its identity: group 1 of the questions is segment 1, and from question 21 a
 * group is a *pair* sharing one clip (`same_segment`, the "CHUNG ĐOẠN" mark in the Word file), so
 * the mapping is by group, never one question per clip. Everything is checked before anything is
 * written, and any disagreement links nothing at all: a question on the wrong clip plays perfectly
 * normal audio and shows up only as answers that stop making sense, which is the worst kind of
 * mistake this tool can make.
 */
export function planLinks(args: {
  /** Every listening question of this exam, as the Word files describe it. */
  questions: readonly { number: number; same_segment: boolean }[];
  /** The 1-based indexes of the clips that exist for this exam. */
  segmentIdxs: readonly number[];
  /** Question number → the clip index it is already attached to. */
  linked: ReadonlyMap<number, number>;
  /**
   * The question numbers that actually exist in the database for this exam.
   *
   * The Word files describe the whole paper, but a question is only importable once
   * `topik-import` has run: linking one that is not there yet would be an UPDATE matching no rows,
   * and the run would report links it never made. Those are reported as "not imported yet"
   * instead, which is the normal state when the Word file arrives before the import.
   */
  existing: ReadonlySet<number>;
}): LinkPlan {
  const ordered = [...args.questions].sort((a, b) => a.number - b.number);
  const reasons: string[] = [];
  if (ordered.length === 0) return { ok: false, reasons: ["no questions found for this exam in the Word files"] };
  if (!ordered.every((q, i) => q.number === i + 1)) {
    reasons.push(
      `the Word file(s) cover questions ${ordered[0]!.number}-${ordered.at(-1)!.number}, which is not a run starting at 1` +
        " — there is no way to tell which clip the first of them belongs to",
    );
    return { ok: false, reasons };
  }

  // Group ordinal per question: a new clip unless this question shares the previous one's.
  const ordinalOf = new Map<number, number>();
  let ordinal = 0;
  for (const [i, q] of ordered.entries()) {
    if (i === 0 || !q.same_segment) ordinal += 1;
    ordinalOf.set(q.number, ordinal);
  }

  const available = new Set(args.segmentIdxs);
  // Questions already attached must sit on their own group's clip. If they do not, the stored data
  // and the Word files disagree about the paper's shape, and guessing which is right is how
  // everything after the disagreement ends up one clip out.
  for (const [number, segmentIdx] of args.linked) {
    const want = ordinalOf.get(number);
    if (want === undefined) reasons.push(`question ${number} is attached to clip ${segmentIdx} but is not in the Word file(s)`);
    else if (want !== segmentIdx) reasons.push(`question ${number} is attached to clip ${segmentIdx}, but the Word file(s) put it on clip ${want}`);
  }

  const links: LinkTarget[] = [];
  const notImported: number[] = [];
  for (const [number, want] of ordinalOf) {
    if (args.linked.has(number)) continue;
    if (!args.existing.has(number)) {
      notImported.push(number);
      continue;
    }
    if (!available.has(want)) {
      reasons.push(`question ${number} needs clip ${want}, which this exam does not have (it has ${args.segmentIdxs.length})`);
      continue;
    }
    links.push({ number, segmentIdx: want, shared: false });
  }
  if (reasons.length > 0) return { ok: false, reasons };

  // A clip is "shared" when more than one question sits on it — the paired questions from 21 on.
  const perGroup = new Map<number, number>();
  for (const want of ordinalOf.values()) perGroup.set(want, (perGroup.get(want) ?? 0) + 1);
  for (const link of links) link.shared = (perGroup.get(link.segmentIdx) ?? 0) > 1;

  const needed = new Set([...ordinalOf.values()]);
  return {
    ok: true,
    links: links.sort((a, b) => a.number - b.number),
    unusedSegments: args.segmentIdxs.filter((i) => !needed.has(i)).sort((a, b) => a - b),
    notImported: notImported.sort((a, b) => a - b),
  };
}
