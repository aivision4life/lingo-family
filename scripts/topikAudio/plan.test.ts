import { describe, expect, it } from "vitest";
import {
  boundarySilences,
  buildSegments,
  examFromAudioName,
  expectedSegmentCount,
  formatMs,
  lastSpeechEnd,
  mergeShortSegments,
  parseSilenceLog,
  countHangul,
  estimateIntroEnd,
  silencesNear,
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

describe("countHangul", () => {
  it("counts Hangul syllables and nothing else", () => {
    expect(countHangul("다음을 듣고 알맞은 그림을 고르십시오. (각 2점)")).toBe(18);
    expect(countHangul("")).toBe(0);
    expect(countHangul(null)).toBe(0);
  });
});

/**
 * `estimateIntroEnd` against all eight real papers (M7.20).
 *
 * Each row is measured, not invented: `silences` are the real `silencedetect` boundaries of that
 * paper's mp3 (the first three answer gaps, plus every silence near the answer, trimmed to keep the
 * fixture readable), `syllables` are the Hangul counts of questions 1-3 in data/topik/, and
 * `approved` is the mark a human actually listened to and approved — the one in production D1.
 *
 * This is the test the old `pickIntroEnd` could never have had: it was wrong on all eight of these
 * papers, by 26 to 62 seconds. A paper that defeats the estimate belongs in this table too.
 */
describe("estimateIntroEnd", () => {
  const papers = [
  {
    exam: "35회",
    syllables: [77, 91, 126],
    approved: 81040,
    silences: [{ start_ms: 76565, end_ms: 77559 }, { start_ms: 78230, end_ms: 78467 }, { start_ms: 79318, end_ms: 81041 }, { start_ms: 81634, end_ms: 82878 }, { start_ms: 84784, end_ms: 85939 }, { start_ms: 103128, end_ms: 115395 }, { start_ms: 140368, end_ms: 152565 }, { start_ms: 184502, end_ms: 196926 }],
  },
  {
    exam: "36회",
    syllables: [64, 83, 124],
    approved: 85370,
    silences: [{ start_ms: 79593, end_ms: 81770 }, { start_ms: 82415, end_ms: 82883 }, { start_ms: 83697, end_ms: 85366 }, { start_ms: 85977, end_ms: 87066 }, { start_ms: 88083, end_ms: 88453 }, { start_ms: 102958, end_ms: 120173 }, { start_ms: 143844, end_ms: 161253 }, { start_ms: 190792, end_ms: 208460 }],
  },
  {
    exam: "37회",
    syllables: [74, 81, 116],
    approved: 98240,
    silences: [{ start_ms: 91661, end_ms: 95154 }, { start_ms: 95826, end_ms: 98236 }, { start_ms: 98445, end_ms: 100066 }, { start_ms: 101094, end_ms: 101609 }, { start_ms: 101748, end_ms: 101949 }, { start_ms: 103026, end_ms: 103862 }, { start_ms: 125318, end_ms: 139516 }, { start_ms: 170470, end_ms: 184664 }, { start_ms: 220341, end_ms: 234997 }],
  },
  {
    exam: "41회",
    syllables: [56, 76, 144],
    approved: 142253,
    silences: [{ start_ms: 136787, end_ms: 138353 }, { start_ms: 139763, end_ms: 142253 }, { start_ms: 142888, end_ms: 145675 }, { start_ms: 158487, end_ms: 171006 }, { start_ms: 192850, end_ms: 205812 }, { start_ms: 245714, end_ms: 259485 }],
  },
  {
    exam: "47회",
    syllables: [77, 64, 119],
    approved: 144593,
    silences: [{ start_ms: 138637, end_ms: 140295 }, { start_ms: 141929, end_ms: 144594 }, { start_ms: 145315, end_ms: 147790 }, { start_ms: 163924, end_ms: 176233 }, { start_ms: 192996, end_ms: 205294 }, { start_ms: 232798, end_ms: 245302 }],
  },
  {
    exam: "52회",
    syllables: [65, 73, 122],
    approved: 165882,
    silences: [{ start_ms: 163798, end_ms: 165882 }, { start_ms: 167477, end_ms: 169830 }, { start_ms: 186207, end_ms: 197437 }, { start_ms: 219026, end_ms: 229865 }, { start_ms: 261586, end_ms: 273008 }],
  },
  {
    exam: "60회",
    syllables: [61, 66, 105],
    approved: 121870,
    silences: [{ start_ms: 117589, end_ms: 118791 }, { start_ms: 119456, end_ms: 119659 }, { start_ms: 120690, end_ms: 121866 }, { start_ms: 122462, end_ms: 124254 }, { start_ms: 125307, end_ms: 125775 }, { start_ms: 142359, end_ms: 151930 }, { start_ms: 174684, end_ms: 184437 }, { start_ms: 217408, end_ms: 227086 }],
  },
  {
    exam: "64회",
    syllables: [56, 58, 104],
    approved: 39480,
    silences: [{ start_ms: 34354, end_ms: 35241 }, { start_ms: 35986, end_ms: 36282 }, { start_ms: 37005, end_ms: 37408 }, { start_ms: 38281, end_ms: 39484 }, { start_ms: 41223, end_ms: 42401 }, { start_ms: 57981, end_ms: 66692 }, { start_ms: 85253, end_ms: 93944 }, { start_ms: 124641, end_ms: 135266 }],
  },
  ] as const;

  const estimate = (paper: (typeof papers)[number]) => estimateIntroEnd(paper.silences, 5_000, paper.syllables);

  for (const paper of papers) {
    it(`lands on the approved mark for ${paper.exam}`, () => {
      const est = estimate(paper);
      expect(est.ok).toBe(true);
      if (!est.ok) return;
      // Milliseconds, not seconds: the suggestion snaps onto a real silence boundary, and that is
      // the same boundary the human picked by ear. A regression here is a changed rule, not drift.
      expect(Math.abs(est.suggested_ms - paper.approved)).toBeLessThanOrEqual(5);
    });
  }

  it("reports a clip-1 length that can be checked against the text", () => {
    // 41회: the detector's old answer (102.169s) would have made clip 1 56s long while question 1's
    // text only needs ~16s. That ratio is what gives a wrong mark away, so it has to be reported.
    const est = estimate(papers[3]);
    expect(est.ok).toBe(true);
    if (!est.ok) return;
    expect(est.clip1_ms).toBeGreaterThan(12_000);
    expect(est.clip1_ms).toBeLessThan(22_000);
    expect(est.speech_end1_ms).toBe(158_487);
  });

  it("measures the narrator's pace from this paper, not from an average", () => {
    const rates = papers.map((p) => {
      const est = estimate(p);
      return est.ok ? est.rate : 0;
    });
    // Real spread across the eight papers: 2.9-4.2 syllables/second. A fixed constant cannot work.
    expect(Math.min(...rates)).toBeGreaterThan(2.5);
    expect(Math.max(...rates)).toBeLessThan(4.5);
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(1);
  });

  it("says it does not know when questions 1-3 are not imported yet", () => {
    const est = estimateIntroEnd(papers[0].silences, 5_000, [0, 0, 0]);
    expect(est).toEqual({ ok: false, reason: "needs questions 1-3 of this exam in data/topik/ to measure reading speed" });
  });

  it("says it does not know when there are not three answer gaps to measure with", () => {
    const est = estimateIntroEnd([{ start_ms: 10_000, end_ms: 25_000 }], 5_000, [56, 76, 144]);
    expect(est.ok).toBe(false);
  });

  it("ignores the quiet at the very start of a file (the 64회 failure mode)", () => {
    // A leading silence is not a structural mark: counted as one, it made the old detector answer
    // 1.07s for a paper whose introduction ends at 39.5s.
    const withLeadingQuiet: Silence[] = [{ start_ms: 0, end_ms: 400 }, ...papers[7].silences];
    const est = estimateIntroEnd(withLeadingQuiet, 5_000, papers[7].syllables);
    expect(est.ok).toBe(true);
    if (!est.ok) return;
    expect(Math.abs(est.suggested_ms - papers[7].approved)).toBeLessThanOrEqual(5);
  });

  it("falls back to the bare arithmetic when no silence is near enough to snap to", () => {
    const far: Silence[] = [
      { start_ms: 158_487, end_ms: 171_006 },
      { start_ms: 192_850, end_ms: 205_812 },
      { start_ms: 245_714, end_ms: 259_485 },
    ];
    const est = estimateIntroEnd(far, 5_000, [56, 76, 144]);
    expect(est.ok).toBe(true);
    if (!est.ok) return;
    expect(est.suggested_ms).toBe(est.raw_ms - 1_400);
  });
});

describe("silencesNear", () => {
  const silences: Silence[] = [
    { start_ms: 1_000, end_ms: 2_000 },
    { start_ms: 10_000, end_ms: 11_000 },
    { start_ms: 12_000, end_ms: 13_000 },
  ];

  it("lists the silences a human could pick instead, in time order", () => {
    expect(silencesNear(silences, 11_500, 2_000)).toEqual([
      { start_ms: 10_000, end_ms: 11_000 },
      { start_ms: 12_000, end_ms: 13_000 },
    ]);
  });

  it("never offers the file's own leading quiet", () => {
    expect(silencesNear([{ start_ms: 0, end_ms: 300 }], 300, 5_000)).toEqual([]);
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
      // M7.6: speech_end moves to the end of the announcement (46.1s), not the dialogue's own
      // 30s — the announcement is talking, and practice plays to speech_end + 5s. end_ms
      // stretches over it either way, which the timed mock test needs.
      { idx: 1, start_ms: 0, speech_end_ms: 46_100, end_ms: 64_000 },
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

describe("lastSpeechEnd", () => {
  // The shape of a real pair clip: dialogue, 20s answer pause, 1.1s announcement, 25s pause.
  const silences = [
    { start_ms: 1_008_000, end_ms: 1_009_200 },
    { start_ms: 1_136_100, end_ms: 1_156_200 },
    { start_ms: 1_157_300, end_ms: 1_182_700 },
  ];

  it("finds the announcement after the long pause, not the dialogue before it", () => {
    expect(lastSpeechEnd(silences, 1_008_158, 1_182_682)).toBe(1_157_300);
  });

  it("returns the clip's end when the talking runs right up to it", () => {
    expect(lastSpeechEnd([{ start_ms: 0, end_ms: 500 }], 0, 10_000)).toBe(10_000);
  });

  it("ignores silence outside the clip", () => {
    expect(lastSpeechEnd([{ start_ms: 0, end_ms: 20_000 }], 5_000, 30_000)).toBe(30_000);
  });

  it("is null for a clip that is silent throughout", () => {
    expect(lastSpeechEnd([{ start_ms: 0, end_ms: 60_000 }], 10_000, 50_000)).toBeNull();
  });
});
