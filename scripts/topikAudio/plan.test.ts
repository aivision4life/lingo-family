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

  it("assigns one segment per question when the counts agree", () => {
    const plan = planAudio(segments, [q(1), q(2), q(3)], 90_000);
    expect(plan.problems).toEqual([]);
    expect([...plan.assignment]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("points both questions of a shared pair at the same segment", () => {
    const two = buildSegments([{ start_ms: 30_000, end_ms: 38_000 }], 90_000, 10_000);
    const plan = planAudio(two, [q(21), q(22, true), q(23)], 90_000);
    expect(plan.expected).toBe(2);
    expect([...plan.assignment]).toEqual([
      [21, 1],
      [22, 1],
      [23, 2],
    ]);
  });

  // The whole point of the safety rule: one miscounted clip would shift every later question onto
  // the wrong audio, and each would still play normally, so nothing would look broken.
  it("assigns nothing when the counts disagree, and says why", () => {
    const plan = planAudio(segments, [q(1), q(2)], 90_000);
    expect(plan.assignment.size).toBe(0);
    expect(plan.problems[0]).toContain("found 3 segment(s) in the audio but the Word file(s) expect 2");
  });

  it("reports a nonsensical boundary", () => {
    const broken = [{ idx: 1, start_ms: 5_000, speech_end_ms: 4_000, end_ms: 9_000 }];
    expect(planAudio(broken, [q(1)], 90_000).problems).toContain("segment 1: speech end outside the segment");
  });
});

describe("examFromAudioName", () => {
  it("maps the file name onto the exam label its questions carry", () => {
    expect(examFromAudioName("TOPIK_Listening_8DeOfficial_60회.mp3")).toBe("8DeOfficial-60회");
    expect(examFromAudioName("TOPIK_Listening_Yonsei_연습1.mp3")).toBe("Yonsei-연습1");
  });

  // A source name may contain underscores; the round is the last part, so splitting on the first
  // underscore would bind the audio to an exam label no question ever has.
  it("splits source from round at the last underscore", () => {
    expect(examFromAudioName("TOPIK_Listening_Master_Topik_연습3.mp3")).toBe("Master_Topik-연습3");
  });

  it("rejects a name that does not follow the convention", () => {
    expect(examFromAudioName("60회.mp3")).toBeNull();
    expect(examFromAudioName("TOPIK_Reading_8DeOfficial_60회.mp3")).toBeNull();
    expect(examFromAudioName("TOPIK_Listening_8DeOfficial_60회.wav")).toBeNull();
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
