import { describe, expect, it } from "vitest";
import {
  boundarySilences,
  buildSegments,
  examFromAudioName,
  expectedSegmentCount,
  formatMs,
  mergeShortSegments,
  parseSilenceLog,
  pickIntroEnd,
  planAudio,
  planLinks,
  silenceHistogram,
  type Silence,
} from "./plan";

const LOG = `
[silencedetect @ 0x1] silence_start: 12.5
[silencedetect @ 0x1] silence_end: 20.25 | silence_duration: 7.75
[silencedetect @ 0x1] silence_start: 45.0
[silencedetect @ 0x1] silence_end: 52.5 | silence_duration: 7.5
`;

describe("parseSilenceLog", () => {
  it("pairs each start with its end", () => {
    expect(parseSilenceLog(LOG, 120_000)).toEqual([
      { start_ms: 12_500, end_ms: 20_250 },
      { start_ms: 45_000, end_ms: 52_500 },
    ]);
  });

  // ffmpeg prints no "silence_end" when the file simply fades out into quiet.
  it("closes a silence that never ends at the end of the file", () => {
    expect(parseSilenceLog(`${LOG}[silencedetect @ 0x1] silence_start: 110.0\n`, 120_000).at(-1)).toEqual({ start_ms: 110_000, end_ms: 120_000 });
  });

  it("ignores everything else ffmpeg prints", () => {
    expect(parseSilenceLog("Input #0, mp3\nStream #0:0: Audio: mp3\n", 1000)).toEqual([]);
  });
});

describe("buildSegments", () => {
  // The gap after a clip belongs to that clip: segment 1 ends where segment 2 starts talking.
  const silences: Silence[] = [
    { start_ms: 5_000, end_ms: 10_000 }, // after the spoken introduction
    { start_ms: 30_000, end_ms: 38_000 }, // after clip 1
    { start_ms: 60_000, end_ms: 65_000 }, // after clip 2
  ];

  it("ends each segment where the next one starts speaking, keeping the pause", () => {
    expect(buildSegments(silences, 90_000, 10_000)).toEqual([
      { idx: 1, start_ms: 10_000, speech_end_ms: 30_000, end_ms: 38_000 },
      { idx: 2, start_ms: 38_000, speech_end_ms: 60_000, end_ms: 65_000 },
      { idx: 3, start_ms: 65_000, speech_end_ms: 90_000, end_ms: 90_000 },
    ]);
  });

  it("leaves the introduction out: no segment starts before it ends", () => {
    expect(buildSegments(silences, 90_000, 10_000)[0]!.start_ms).toBe(10_000);
  });

  it("treats quiet that runs to the end of the file as the last segment's tail, not a boundary", () => {
    const withTail = [...silences, { start_ms: 85_000, end_ms: 90_000 }];
    const last = buildSegments(withTail, 90_000, 10_000).at(-1)!;
    expect(last).toEqual({ idx: 3, start_ms: 65_000, speech_end_ms: 85_000, end_ms: 90_000 });
  });
});

describe("pickIntroEnd", () => {
  // Measured on the first real paper: the instructions run for 100s and are followed by a pause of
  // only 1.7s, while every answer gap after that is 15-18s. Taking the *longest* early pause would
  // therefore skip past question 1 entirely.
  const realistic: Silence[] = [
    { start_ms: 100_833, end_ms: 102_487 }, // 1.7s, right after the instructions
    { start_ms: 154_436, end_ms: 169_786 }, // 15.3s, the first answer gap
  ];

  it("takes the first pause long enough to count, not the longest one", () => {
    expect(pickIntroEnd(realistic, 800, 120_000)).toBe(102_487);
  });

  it("ignores pauses shorter than the minimum and ones past the window", () => {
    expect(pickIntroEnd(realistic, 5_000, 120_000)).toBe(0);
    expect(pickIntroEnd(realistic, 800, 60_000)).toBe(0);
  });

  it("starts at zero when the file opens straight into the first question", () => {
    expect(pickIntroEnd([], 800, 120_000)).toBe(0);
  });
});

describe("boundarySilences", () => {
  const silences: Silence[] = [
    { start_ms: 0, end_ms: 1_500 }, // 1.5s: a speaker turn inside a dialogue
    { start_ms: 10_000, end_ms: 25_300 }, // 15.3s: an answer gap
  ];

  it("keeps only the pauses that are long enough to end a clip", () => {
    expect(boundarySilences(silences, 5_000)).toEqual([{ start_ms: 10_000, end_ms: 25_300 }]);
  });

  // The real paper's two populations are 1-2s and 15-18s, so anything in between behaves the same.
  it("gives the same answer anywhere inside the empty band between the two populations", () => {
    for (const threshold of [3_000, 5_000, 8_000, 12_000]) expect(boundarySilences(silences, threshold)).toHaveLength(1);
  });
});

describe("silenceHistogram", () => {
  it("counts the pauses per band so a bad threshold is visible", () => {
    const silences: Silence[] = [
      { start_ms: 0, end_ms: 500 },
      { start_ms: 1_000, end_ms: 2_500 },
      { start_ms: 5_000, end_ms: 20_300 },
      { start_ms: 30_000, end_ms: 51_000 },
    ];
    expect(silenceHistogram(silences)).toEqual([
      { label: "0-1s", count: 1 },
      { label: "1-2s", count: 1 },
      { label: "2-3s", count: 0 },
      { label: "3-5s", count: 0 },
      { label: "5-8s", count: 0 },
      { label: "8-12s", count: 0 },
      { label: "12-20s", count: 1 }, // the 15.3s answer gap
      { label: "≥20s", count: 1 },
    ]);
  });
});

describe("mergeShortSegments", () => {
  // Shaped like the real paper: a dialogue, then the narrator saying only "22번" between the two
  // answer gaps, which silence detection cannot tell from a clip of its own.
  const segments = [
    { idx: 1, start_ms: 0, speech_end_ms: 30_000, end_ms: 45_000 },
    { idx: 2, start_ms: 45_000, speech_end_ms: 46_100, end_ms: 64_000 },
    { idx: 3, start_ms: 64_000, speech_end_ms: 100_000, end_ms: 115_000 },
  ];

  it("folds the announcement into the dialogue before it", () => {
    const { segments: out, merged } = mergeShortSegments(segments, 5_000);
    expect(merged).toBe(1);
    expect(out).toEqual([
      // The dialogue's own speech end is kept, so practice replays the talking and not the gap;
      // end_ms stretches over the announcement, which the timed mock test needs.
      { idx: 1, start_ms: 0, speech_end_ms: 30_000, end_ms: 64_000 },
      { idx: 2, start_ms: 64_000, speech_end_ms: 100_000, end_ms: 115_000 },
    ]);
  });

  it("renumbers what is left so the indexes stay 1..n", () => {
    expect(mergeShortSegments(segments, 5_000).segments.map((s) => s.idx)).toEqual([1, 2]);
  });

  it("keeps a short first segment, which has nothing to merge into", () => {
    const first = [{ idx: 1, start_ms: 0, speech_end_ms: 900, end_ms: 20_000 }, segments[2]!];
    expect(mergeShortSegments(first, 5_000).merged).toBe(0);
  });

  it("changes nothing when every clip is long enough", () => {
    const long = [segments[0]!, segments[2]!];
    expect(mergeShortSegments(long, 5_000)).toEqual({ segments: [long[0], { ...long[1], idx: 2 }], merged: 0 });
  });
});

describe("expectedSegmentCount", () => {
  it("counts one clip per question", () => {
    expect(expectedSegmentCount([q(1), q(2), q(3)])).toBe(3);
  });

  // A dialogue followed by two questions: the second one is marked as sharing the first's clip.
  it("counts a shared pair as one clip", () => {
    expect(expectedSegmentCount([q(21), q(22, true), q(23), q(24, true)])).toBe(2);
  });

  it("ignores a share mark on the first question, which has nothing to share with", () => {
    expect(expectedSegmentCount([q(1, true), q(2)])).toBe(2);
  });

  it("reads the questions in number order, not file order", () => {
    expect(expectedSegmentCount([q(22, true), q(21)])).toBe(1);
  });
});

describe("planAudio", () => {
  const segments = buildSegments(
    [
      { start_ms: 30_000, end_ms: 38_000 },
      { start_ms: 60_000, end_ms: 65_000 },
    ],
    90_000,
    10_000,
  );

  it("assigns one clip per question when the Word files cover the whole paper", () => {
    const plan = planAudio(segments, [q(1), q(2), q(3)], 90_000);
    expect(plan.problems).toEqual([]);
    expect(plan.coverage).toBe("full");
    expect([...plan.assignment]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("points both questions of a shared pair at the same clip", () => {
    const plan = planAudio(segments, [q(1), q(2, true), q(3)], 90_000);
    expect(plan.expected).toBe(2);
    expect([...plan.assignment]).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
  });

  // Typing up three questions to try the workflow out, against the whole paper's audio.
  it("assigns from the front when the Word files cover only the start of the paper", () => {
    const plan = planAudio(segments, [q(1), q(2)], 90_000);
    expect(plan.coverage).toBe("partial");
    expect([...plan.assignment]).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(plan.problems).toEqual([]);
  });

  // The whole point of the safety rule: one misaligned clip would move every later question onto
  // the wrong audio, and each would still play normally, so nothing would look broken.
  it("refuses to assign when the questions start mid-paper, even if the counts happen to match", () => {
    const plan = planAudio(segments, [q(21), q(22, true), q(23)], 90_000);
    expect(plan.assignment.size).toBe(0);
    expect(plan.coverage).toBe("none");
    expect(plan.problems[0]).toContain("not a run starting at 1");
  });

  it("refuses to assign when a question is missing from the middle", () => {
    const plan = planAudio(segments, [q(1), q(3)], 90_000);
    expect(plan.assignment.size).toBe(0);
    expect(plan.problems[0]).toContain("not a run starting at 1");
  });

  it("refuses to assign when the audio has fewer clips than the questions need", () => {
    const plan = planAudio(segments, [q(1), q(2), q(3), q(4)], 90_000);
    expect(plan.assignment.size).toBe(0);
    expect(plan.problems[0]).toContain("expect 4 clip(s) but only 3 were found");
  });

  it("says so when no question was found at all", () => {
    expect(planAudio(segments, [], 90_000).problems[0]).toContain("no questions found");
  });

  it("reports a nonsensical boundary", () => {
    const broken = [{ idx: 1, start_ms: 5_000, speech_end_ms: 4_000, end_ms: 9_000 }];
    expect(planAudio(broken, [q(1)], 90_000).problems).toContain("segment 1: speech end outside the segment");
  });
});

describe("examFromAudioName", () => {
  // File names stay ASCII, exam labels stay Korean; this function is the only place they meet.
  it("turns the ASCII round token into the Korean label the questions carry", () => {
    expect(examFromAudioName("TOPIK_Listening_OfficialTest_Test35.mp3")).toEqual({ ok: true, exam: "OfficialTest-35회" });
    expect(examFromAudioName("TOPIK_Listening_8DeOfficial_Test60.mp3")).toEqual({ ok: true, exam: "8DeOfficial-60회" });
  });

  it("treats Test01 and Test1 as the same round", () => {
    expect(examFromAudioName("TOPIK_Listening_NewHotTopik_Test01.mp3")).toEqual({ ok: true, exam: "NewHotTopik-1회" });
  });

  // A source name may contain underscores; the round is the last part.
  it("splits source from round at the last underscore", () => {
    expect(examFromAudioName("TOPIK_Listening_Master_Topik_Test3.mp3")).toEqual({ ok: true, exam: "Master_Topik-3회" });
  });

  // The whole point: a name it cannot read must stop the exam, not quietly invent a label. A
  // silent fallback mislabelled an entire import once already.
  it("reports an error instead of guessing when the round token is missing or unreadable", () => {
    expect(examFromAudioName("TOPIK_Listening_OfficialTest_35회.mp3")).toMatchObject({ ok: false });
    expect(examFromAudioName("TOPIK_Listening_Yonsei_Practice1.mp3")).toMatchObject({ ok: false });
    expect(examFromAudioName("TOPIK_Listening_OfficialTest.mp3")).toMatchObject({ ok: false });
    expect(examFromAudioName("35회.mp3")).toMatchObject({ ok: false });
    expect(examFromAudioName("TOPIK_Reading_OfficialTest_Test35.mp3")).toMatchObject({ ok: false });
  });

  it("names the expected pattern in the error, so the fix is obvious", () => {
    const result = examFromAudioName("TOPIK_Listening_Yonsei_Practice1.mp3");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Test<N>");
  });
});

describe("formatMs", () => {
  it("formats as mm:ss.mmm", () => {
    expect(formatMs(0)).toBe("00:00.000");
    expect(formatMs(62_340)).toBe("01:02.340");
    expect(formatMs(3_600_000)).toBe("60:00.000");
  });
});

function q(number: number, same_segment = false) {
  return { number, same_segment };
}

/**
 * `--link-only` (M7.2): attaching questions to clips that already exist and are already approved.
 * The pairs from question 21 on are the reason this cannot be "one question, one clip".
 */
describe("planLinks", () => {
  /** Questions 1..n, each on its own clip. */
  const solo = (n: number) => Array.from({ length: n }, (_, i) => ({ number: i + 1, same_segment: false }));
  const idxs = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  /** Everything the Word files describe is also in the database, unless a test says otherwise. */
  const allImported = (questions: readonly { number: number }[]) => new Set(questions.map((q) => q.number));

  it("links the questions that have no clip to the clips that have no question", () => {
    const plan = planLinks({
      questions: solo(20),
      segmentIdxs: idxs(36),
      linked: new Map(idxs(12).map((n) => [n, n])),
      existing: allImported(solo(20)),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.links.map((l) => [l.number, l.segmentIdx])).toEqual([13, 14, 15, 16, 17, 18, 19, 20].map((n) => [n, n]));
    // The clips for questions nobody has typed up yet are simply left alone.
    expect(plan.unusedSegments).toEqual(idxs(36).slice(20));
  });

  it("puts both questions of a pair on the one clip they share", () => {
    // The real shape from question 21: one dialogue, two questions about it.
    const questions = [
      ...solo(20),
      { number: 21, same_segment: false },
      { number: 22, same_segment: true },
      { number: 23, same_segment: false },
      { number: 24, same_segment: true },
    ];
    const plan = planLinks({ questions, segmentIdxs: idxs(36), linked: new Map(idxs(20).map((n) => [n, n])), existing: allImported(questions) });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.links.map((l) => [l.number, l.segmentIdx])).toEqual([
      [21, 21],
      [22, 21],
      [23, 22],
      [24, 22],
    ]);
    expect(plan.links.every((l) => l.shared)).toBe(true);
  });

  it("links the second half of a pair to the clip its partner already has", () => {
    // Question 21 was linked in an earlier run; 22 shares its clip and must land on the same one,
    // not on the next free clip — which is exactly how everything after it would shift by one.
    const questions = [...solo(20), { number: 21, same_segment: false }, { number: 22, same_segment: true }];
    const plan = planLinks({
      questions,
      segmentIdxs: idxs(36),
      linked: new Map([...idxs(20).map((n) => [n, n] as const), [21, 21]]),
      existing: allImported(questions),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.links).toEqual([{ number: 22, segmentIdx: 21, shared: true }]);
  });

  it("links nothing when the stored links disagree with the Word files", () => {
    // Question 5 sits on clip 6: either the clips were cut differently or the paper changed, and
    // guessing which is right puts every question after it one clip out.
    const plan = planLinks({ questions: solo(20), segmentIdxs: idxs(36), linked: new Map([[5, 6]]), existing: allImported(solo(20)) });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons[0]).toContain("question 5 is attached to clip 6");
  });

  it("links nothing when a question needs a clip the exam does not have", () => {
    const plan = planLinks({ questions: solo(20), segmentIdxs: idxs(12), linked: new Map(idxs(12).map((n) => [n, n])), existing: allImported(solo(20)) });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons[0]).toContain("needs clip 13");
  });

  it("links nothing when the questions do not start at 1", () => {
    const plan = planLinks({
      questions: [{ number: 21, same_segment: false }, { number: 22, same_segment: true }],
      segmentIdxs: idxs(36),
      linked: new Map(),
      existing: new Set([21, 22]),
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reasons[0]).toContain("not a run starting at 1");
  });

  it("has nothing to do when every question already has its clip", () => {
    const plan = planLinks({ questions: solo(12), segmentIdxs: idxs(36), linked: new Map(idxs(12).map((n) => [n, n])), existing: allImported(solo(12)) });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.links).toEqual([]);
    expect(plan.unusedSegments).toHaveLength(24);
  });


  it("does not try to link a question the Word file describes but nobody has imported yet", () => {
    // The usual order: the Word file is written, then `topik-import` runs. Planning a link for a
    // row that does not exist would be an UPDATE matching nothing, reported as a link that worked.
    const plan = planLinks({
      questions: solo(20),
      segmentIdxs: idxs(36),
      linked: new Map(idxs(12).map((n) => [n, n])),
      existing: new Set(idxs(12)),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.links).toEqual([]);
    expect(plan.notImported).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
  });
  it("refuses an exam with no questions in the Word files at all", () => {
    expect(planLinks({ questions: [], segmentIdxs: idxs(36), linked: new Map(), existing: new Set() }).ok).toBe(false);
  });
});
