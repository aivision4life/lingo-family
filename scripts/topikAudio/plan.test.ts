import { describe, expect, it } from "vitest";
import {
  buildSegments,
  examFromAudioName,
  expectedSegmentCount,
  formatMs,
  parseSilenceLog,
  pickIntroEnd,
  planAudio,
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
  it("takes the end of the longest early silence", () => {
    const silences: Silence[] = [
      { start_ms: 2_000, end_ms: 3_000 },
      { start_ms: 5_000, end_ms: 12_000 },
      { start_ms: 30_000, end_ms: 40_000 }, // outside the search window
    ];
    expect(pickIntroEnd(silences, 20_000)).toBe(12_000);
  });

  it("starts at zero when the file opens straight into the first question", () => {
    expect(pickIntroEnd([], 20_000)).toBe(0);
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
