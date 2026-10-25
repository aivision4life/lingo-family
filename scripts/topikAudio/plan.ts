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
 * dropped: it belongs to no question. `introEndMs` is where the first clip's speech begins; it is
 * chosen by the caller (see `pickIntroEnd`), because only a human can tell the introduction from
 * the first question.
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
 * Where the spoken introduction ends: at the start of speech after the *first* pause of at least
 * `minPauseMs`, searched only in the opening `windowMs` of the file.
 *
 * Not the longest early pause: the gap after the instructions can be short (1.7s in the first real
 * paper) while the answer gaps that follow are ten times longer, so "longest" would skip the whole
 * first question. 0 means no pause was found and the caller should treat the file as starting
 * straight into question 1 — which the review screen will show as a suspiciously long segment 1.
 */
export function pickIntroEnd(silences: readonly Silence[], minPauseMs: number, windowMs: number): number {
  const first = silences.find((s) => s.start_ms <= windowMs && s.end_ms - s.start_ms >= minPauseMs);
  return first?.end_ms ?? 0;
}

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
 * The merged clip keeps the dialogue's own `start_ms`/`speech_end_ms`, so practice still plays the
 * talking and nothing else, while `end_ms` stretches to where the next real clip begins, which is
 * what the timed mock test needs. The merge is always reported, and the exam stays unverified.
 */
export function mergeShortSegments(segments: readonly Segment[], minSpeechMs: number): { segments: Segment[]; merged: number } {
  const out: Segment[] = [];
  let merged = 0;
  for (const s of segments) {
    const previous = out.at(-1);
    // A short *first* segment has nothing to merge into; it is kept so it surfaces as a mismatch.
    if (previous && s.speech_end_ms - s.start_ms < minSpeechMs) {
      previous.end_ms = s.end_ms;
      merged += 1;
      continue;
    }
    out.push({ ...s, idx: out.length + 1 });
  }
  return { segments: out, merged };
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
  /** `question.number` → 1-based segment index, empty when the counts disagree. */
  assignment: Map<number, number>;
  expected: number;
  problems: string[];
};

/**
 * Matches proposed segments against the questions of one exam.
 *
 * When the counts disagree, nothing is assigned. Assigning in order anyway would put every
 * question after the miscount onto the wrong clip, and — unlike a missing file — each one would
 * still play perfectly normal audio, so the mistake would surface only as answers that slowly stop
 * making sense. The exam stays unverified and out of practice until a human has looked.
 */
export function planAudio(
  segments: Segment[],
  questions: readonly { number: number; same_segment: boolean }[],
  durationMs: number,
): AudioPlan {
  const expected = expectedSegmentCount(questions);
  const problems: string[] = [];
  if (segments.length !== expected) {
    problems.push(
      `found ${segments.length} segment(s) in the audio but the Word file(s) expect ${expected}` +
        ` — questions were NOT assigned; fix the boundaries by hand before approving`,
    );
  }
  for (const s of segments) {
    if (s.start_ms >= s.end_ms) problems.push(`segment ${s.idx}: starts at or after it ends`);
    else if (s.speech_end_ms < s.start_ms || s.speech_end_ms > s.end_ms) problems.push(`segment ${s.idx}: speech end outside the segment`);
    if (s.end_ms > durationMs) problems.push(`segment ${s.idx}: ends past the end of the file`);
  }

  const assignment = new Map<number, number>();
  if (segments.length === expected) {
    const ordered = [...questions].sort((a, b) => a.number - b.number);
    let idx = 0;
    for (const [i, q] of ordered.entries()) {
      if (i === 0 || !q.same_segment) idx += 1;
      assignment.set(q.number, idx);
    }
  }
  return { segments, assignment, expected, problems };
}

/** "01:02.340" — how timestamps are shown in the report and the review screen. */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}

/**
 * "TOPIK_Listening_8DeOfficial_60회.mp3" → "8DeOfficial-60회", the exam label its questions carry.
 * The source may itself contain underscores, so the *last* underscore separates source from round.
 */
export function examFromAudioName(fileName: string): string | null {
  const m = /^TOPIK_Listening_(.+)_([^_]+)\.mp3$/i.exec(fileName);
  return m ? `${m[1]}-${m[2]}` : null;
}
