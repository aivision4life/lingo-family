import { describe, expect, it } from "vitest";
import { audioNameFromExam, examFromAudioName } from "./plan";
import { clampLastSegmentToTape, introCandidates, numberTracks, planTracks, samplesPerFrame, trackNumberFromName, verifyTrackBoundaries, type TrackProbe } from "./tracks";

/** The shape 83회 really has: a long file per question 1-20, then (dialogue, announcement) pairs. */
function track(number: number, durationS: number, speechEndS: number | null): TrackProbe {
  return {
    number,
    file: `${String(number).padStart(2, "0")} 트랙 ${number}.mp3`,
    durationMs: Math.round(durationS * 1000),
    // The tape is always a little longer than the container duration (encoder delay + padding).
    frameMs: Math.round(durationS * 1000) + 120,
    speechEndMs: speechEndS === null ? null : Math.round(speechEndS * 1000),
    codec: "mp3",
    sampleRate: 44_100,
    channels: 2,
  };
}

/** `singles` questions of their own, then `pairs` pairs — the real 20 + 15 of a TOPIK II paper. */
function paper(singles: number, pairs: number) {
  const tracks = [track(1, 85.3, null)];
  const questions: { number: number; same_segment: boolean }[] = [];
  for (let i = 0; i < singles; i += 1) {
    tracks.push(track(tracks.length + 1, 40, 27));
    questions.push({ number: questions.length + 1, same_segment: false });
  }
  for (let i = 0; i < pairs; i += 1) {
    tracks.push(track(tracks.length + 1, 145, 132));
    questions.push({ number: questions.length + 1, same_segment: false });
    tracks.push(track(tracks.length + 1, 15.1, 1.8));
    questions.push({ number: questions.length + 1, same_segment: true });
  }
  return { tracks, questions };
}

describe("trackNumberFromName", () => {
  it("reads the leading number of the publisher's own names", () => {
    expect(trackNumberFromName("01 트랙 1.mp3")).toEqual({ ok: true, number: 1 });
    expect(trackNumberFromName("22 트랙 22.mp3")).toEqual({ ok: true, number: 22 });
  });

  // A file whose position cannot be read must stop the run: a guessed position silently shifts
  // every question after it onto the wrong clip while the audio still plays normally.
  it("refuses a name with no leading number", () => {
    expect(trackNumberFromName("트랙 22.mp3").ok).toBe(false);
  });
});

describe("numberTracks", () => {
  const names = (n: number, make: (i: number) => string) => Array.from({ length: n }, (_, i) => make(i));

  it("uses the leading number when the folder runs 1..N (83회, 91회)", () => {
    const r = numberTracks(names(51, (i) => `${String(i + 1).padStart(2, "0")} 트랙 ${i + 1}.mp3`));
    expect(r.ok && r.numbers.get("01 트랙 1.mp3")).toBe(1);
    expect(r.ok && r.numbers.get("51 트랙 51.mp3")).toBe(51);
  });

  // 96회 ships "2-00.mp3".."2-50.mp3": the 2 is the section, and 2-00 is the introduction.
  it("reads <section>-<index> as a 0-based index, so 2-00 is track 1", () => {
    const r = numberTracks(names(51, (i) => `2-${String(i).padStart(2, "0")}.mp3`));
    expect(r.ok && r.scheme).toContain("0-based");
    expect(r.ok && r.numbers.get("2-00.mp3")).toBe(1);
    expect(r.ok && r.numbers.get("2-21.mp3")).toBe(22);
    expect(r.ok && r.numbers.get("2-50.mp3")).toBe(51);
  });

  it("reads a 1-based <section>-<index> folder as it is", () => {
    const r = numberTracks(names(51, (i) => `2-${String(i + 1).padStart(2, "0")}.mp3`));
    expect(r.ok && r.scheme).toContain("1-based");
    expect(r.ok && r.numbers.get("2-01.mp3")).toBe(1);
    expect(r.ok && r.numbers.get("2-51.mp3")).toBe(51);
  });

  // A guessed position plays normally and puts every later question on the wrong clip.
  it("refuses a hole, two sections, a duplicate and an unreadable name", () => {
    expect(numberTracks(["01 a.mp3", "03 a.mp3"]).ok).toBe(false);
    expect(numberTracks(["2-00.mp3", "3-01.mp3"]).ok).toBe(false);
    expect(numberTracks(["2-00.mp3", "2-00.mp3"]).ok).toBe(false);
    expect(numberTracks(["트랙 1.mp3", "트랙 2.mp3"]).ok).toBe(false);
    expect(numberTracks([]).ok).toBe(false);
  });
});

describe("clampLastSegmentToTape", () => {
  const segs = (lastEndMs: number, lastSpeechEndMs: number) => [
    { idx: 1, start_ms: 0, speech_end_ms: 1_000, end_ms: 2_000 },
    { idx: 2, start_ms: 2_000, speech_end_ms: lastSpeechEndMs, end_ms: lastEndMs },
  ];

  it("leaves a plan that fits inside the tape alone", () => {
    const r = clampLastSegmentToTape(segs(10_000, 9_000), 10_000);
    expect(r.ok && r.trimmedMs).toBe(0);
    expect(r.ok && r.segments.at(-1)!.end_ms).toBe(10_000);
  });

  // 96회: the frame-count sum predicted 62:07.623, the written tape measured 62:07.621.
  it("pulls a last clip that ends a hair past the tape back to its end", () => {
    const r = clampLastSegmentToTape(segs(3_727_623, 3_672_854), 3_727_621);
    expect(r.ok && r.trimmedMs).toBe(2);
    expect(r.ok && r.segments.at(-1)!.end_ms).toBe(3_727_621);
    expect(r.ok && r.segments.at(-1)!.speech_end_ms).toBe(3_672_854);
  });

  it("pulls a speech end past the tape back too", () => {
    const r = clampLastSegmentToTape(segs(10_050, 10_020), 10_000);
    expect(r.ok && r.segments.at(-1)!.speech_end_ms).toBe(10_000);
  });

  // A gap that big is not rounding: something about the join is wrong and the caller must stop.
  it("refuses an overshoot past the drift budget instead of trimming it away", () => {
    const r = clampLastSegmentToTape(segs(11_000, 9_000), 10_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.overshootMs).toBe(1_000);
  });

  it("does not touch the earlier clips", () => {
    const r = clampLastSegmentToTape(segs(10_002, 9_000), 10_000);
    expect(r.ok && r.segments[0]).toEqual({ idx: 1, start_ms: 0, speech_end_ms: 1_000, end_ms: 2_000 });
  });
});

describe("samplesPerFrame", () => {
  it("knows the MPEG-1 and MPEG-2 frame sizes", () => {
    expect(samplesPerFrame(44_100)).toBe(1152);
    expect(samplesPerFrame(22_050)).toBe(576);
    expect(samplesPerFrame(9_999)).toBeNull();
  });
});

describe("audioNameFromExam", () => {
  it("round-trips with examFromAudioName", () => {
    const named = audioNameFromExam("OfficialTest-83회");
    expect(named).toEqual({ ok: true, fileName: "TOPIK_Listening_OfficialTest_Test83.mp3" });
    expect(named.ok && examFromAudioName(named.fileName)).toEqual({ ok: true, exam: "OfficialTest-83회" });
  });

  it("refuses a label it cannot write as a file name", () => {
    expect(audioNameFromExam("연습3").ok).toBe(false);
    expect(audioNameFromExam("Official_Test-83회").ok).toBe(false);
  });
});

describe("planTracks", () => {
  it("lays a 50-question paper out as 35 clips, track 1 being the introduction", () => {
    const { tracks, questions } = paper(20, 15);
    const plan = planTracks({ tracks, questions, introInTrackMs: 0 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(tracks).toHaveLength(51);
    expect(plan.segments).toHaveLength(35);
    expect(plan.introEndMs).toBe(85_420);
    expect(plan.segments[0]!.start_ms).toBe(85_420);
    expect(plan.totalMs).toBe(plan.segments.at(-1)!.end_ms);
    expect(plan.warnings).toEqual([]);
  });

  // The boundary is the join, so a clip's start must be exactly where the previous one ends: no
  // gap is dropped and no audio is played twice.
  it("leaves no gap between clips", () => {
    const { tracks, questions } = paper(20, 15);
    const plan = planTracks({ tracks, questions, introInTrackMs: 0 });
    if (!plan.ok) throw new Error("expected a plan");
    for (const [i, s] of plan.segments.entries()) if (i > 0) expect(s.start_ms).toBe(plan.segments[i - 1]!.end_ms);
  });

  // Both questions of a pair are asked about one dialogue, and the announcement at the end of the
  // second file is the only thing that tells the learner the second question has begun (M7.6).
  it("gives a pair one clip whose speech end is the announcement in the short file", () => {
    const { tracks, questions } = paper(1, 1);
    const plan = planTracks({ tracks, questions, introInTrackMs: 0 });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.segments).toHaveLength(2);
    const pair = plan.segments[1]!;
    // Track 3 (the dialogue) starts after track 1 + track 2, track 4 (the announcement) after it.
    expect(pair.start_ms).toBe(85_420 + 40_120);
    expect(pair.end_ms).toBe(85_420 + 40_120 + 145_120 + 15_220);
    expect(pair.speech_end_ms).toBe(85_420 + 40_120 + 145_120 + 1_800);
    expect(plan.tracksOf.get(2)).toEqual([3, 4]);
    expect(plan.tracksOf.get(3)).toEqual([4]);
  });

  it("stops when the file count does not match the questions", () => {
    const { tracks, questions } = paper(20, 15);
    const plan = planTracks({ tracks: tracks.slice(0, 50), questions, introInTrackMs: 0 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons.join(" ")).toContain("50 track file(s) for 50 question(s): expected 51");
  });

  it("stops when the numbering has a hole", () => {
    const { tracks, questions } = paper(2, 0);
    const plan = planTracks({ tracks: [...tracks.slice(0, 2), track(9, 40, 27)], questions, introInTrackMs: 0 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons.join(" ")).toContain("do not run 1..3");
  });

  // The pairing comes from the Word file; the files on disk are the only check on it.
  it("stops when the second file of a pair is not a short announcement", () => {
    const { tracks, questions } = paper(0, 1);
    const long = { ...tracks[2]!, speechEndMs: 40_000 };
    const plan = planTracks({ tracks: [tracks[0]!, tracks[1]!, long], questions, introInTrackMs: 0 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons.join(" ")).toContain("second of a pair) speaks for 40.0s");
  });

  it("stops when the second file of a pair is not shorter than the first", () => {
    const { tracks, questions } = paper(0, 1);
    const plan = planTracks({ tracks: [tracks[0]!, tracks[1]!, { ...tracks[2]!, durationMs: 200_000 }], questions, introInTrackMs: 0 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons.join(" ")).toContain("not shorter than track 2");
  });

  it("stops when a file's speech end could not be measured", () => {
    const { tracks, questions } = paper(2, 0);
    const plan = planTracks({ tracks: [tracks[0]!, { ...tracks[1]!, speechEndMs: null }, tracks[2]!], questions, introInTrackMs: 0 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons.join(" ")).toContain("no pause of at least --silence");
  });

  // A stream-copy join needs one format; re-encoding one odd file would be a silent quality change.
  it("stops when the files are not all the same format", () => {
    const { tracks, questions } = paper(2, 0);
    const plan = planTracks({ tracks: [tracks[0]!, { ...tracks[1]!, sampleRate: 22_050 }, tracks[2]!], questions, introInTrackMs: 0 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons.join(" ")).toContain("a stream-copy join needs one format");
  });

  it("stops when the Word file does not start at question 1", () => {
    const { tracks } = paper(2, 0);
    const plan = planTracks({ tracks, questions: [{ number: 21, same_segment: false }, { number: 22, same_segment: false }], introInTrackMs: 0 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons.join(" ")).toContain("not a run starting at 1");
  });

  // Not an error — a real question could be that short — but it is the shape of a mis-paired file.
  it("warns about a question of its own whose file holds only an announcement", () => {
    const { tracks, questions } = paper(2, 0);
    const plan = planTracks({ tracks: [tracks[0]!, { ...tracks[1]!, speechEndMs: 1_800 }, tracks[2]!], questions, introInTrackMs: 0 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.warnings.join(" ")).toContain("speaks for only 1.8s");
  });

  // 83회: track 2 opens with "제83회 한국어능력시험…", so question 1 starts inside the file.
  it("moves clip 1 by --intro-in-track and nothing else", () => {
    const { tracks, questions } = paper(2, 0);
    const plan = planTracks({ tracks, questions, introInTrackMs: 20_000 });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.introEndMs).toBe(85_420 + 20_000);
    expect(plan.segments[0]!.start_ms).toBe(85_420 + 20_000);
    // Its speech end is measured inside the file, so the mark must not move it.
    expect(plan.segments[0]!.speech_end_ms).toBe(85_420 + 27_000);
    expect(plan.segments[0]!.end_ms).toBe(85_420 + 40_120);
    expect(plan.segments[1]!.start_ms).toBe(85_420 + 40_120);
  });

  it("stops when --intro-in-track is at or past the file's own speech end", () => {
    const { tracks, questions } = paper(2, 0);
    const plan = planTracks({ tracks, questions, introInTrackMs: 27_000 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons.join(" ")).toContain("so question 1 would have no audio");
  });

  it("stops on a negative --intro-in-track", () => {
    const { tracks, questions } = paper(2, 0);
    expect(planTracks({ tracks, questions, introInTrackMs: -1 }).ok).toBe(false);
  });
});

describe("introCandidates", () => {
  const silences = [
    { start_ms: 0, end_ms: 1_108 },
    { start_ms: 18_502, end_ms: 19_658 },
    { start_ms: 24_980, end_ms: 27_034 },
    { start_ms: 28_290, end_ms: 29_985 },
    { start_ms: 35_184, end_ms: 35_662 },
    { start_ms: 40_520, end_ms: 42_244 },
    { start_ms: 60_167, end_ms: 70_269 },
  ];

  it("offers the longest pauses before the answering gap, in file order", () => {
    expect(introCandidates({ silences, speechEndMs: 60_167 })).toEqual([
      { markMs: 19_658, pauseMs: 1_156 },
      { markMs: 27_034, pauseMs: 2_054 },
      { markMs: 29_985, pauseMs: 1_695 },
      { markMs: 42_244, pauseMs: 1_724 },
    ]);
  });

  // The file's own leading quiet is not a structural mark, and neither is the answering gap.
  it("leaves out the leading quiet, the answering gap and anything too short", () => {
    const marks = introCandidates({ silences, speechEndMs: 60_167, max: 99 }).map((c) => c.markMs);
    expect(marks).not.toContain(1_108);
    expect(marks).not.toContain(70_269);
    expect(marks).not.toContain(35_662);
  });
});

describe("verifyTrackBoundaries", () => {
  const segments = [
    { idx: 1, start_ms: 85_000, speech_end_ms: 145_000, end_ms: 155_000 },
    { idx: 2, start_ms: 155_000, speech_end_ms: 172_000, end_ms: 182_000 },
  ];

  it("measures each clip against the silence the written tape really has", () => {
    const checks = verifyTrackBoundaries({
      segments,
      silences: [
        { start_ms: 144_988, end_ms: 155_000 },
        { start_ms: 171_990, end_ms: 182_000 },
      ],
      minSilenceMs: 5_000,
    });
    expect(checks.map((c) => c.driftMs)).toEqual([-12, -10]);
    expect(checks[1]!.startInSilence).toBe(true);
  });

  // Clip 1 opens at the end of the introduction, where the pause is the introduction's own and can
  // be far shorter than an answering gap; the check does not apply there.
  it("does not ask clip 1 to start inside an answering gap", () => {
    const checks = verifyTrackBoundaries({ segments, silences: [{ start_ms: 144_988, end_ms: 155_000 }], minSilenceMs: 5_000 });
    expect(checks[0]!.appliesToStart).toBe(false);
    expect(checks[1]!.appliesToStart).toBe(true);
  });

  it("reports no drift at all when the tape holds no long silence", () => {
    expect(verifyTrackBoundaries({ segments, silences: [], minSilenceMs: 5_000 }).map((c) => c.driftMs)).toEqual([null, null]);
  });
});
