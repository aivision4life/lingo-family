import { describe, expect, it } from "vitest";
import { segmentBoundsError, splitBoxedSentence, splitUnderline, stripUnderline, topikSegmentUpdateSchema } from "./topik";

describe("splitUnderline", () => {
  it("returns one plain run for text with no markup", () => {
    expect(splitUnderline("아침에 전화를 드렸다.")).toEqual([{ text: "아침에 전화를 드렸다.", underlined: false }]);
  });

  it("splits plain/underlined/plain around one marked phrase", () => {
    expect(splitUnderline("어제 본 공연은 눈물이 <u>날 정도로</u> 감동적이었다.")).toEqual([
      { text: "어제 본 공연은 눈물이 ", underlined: false },
      { text: "날 정도로", underlined: true },
      { text: " 감동적이었다.", underlined: false },
    ]);
  });

  it("handles underline at the very start or end with nothing left over", () => {
    expect(splitUnderline("<u>전부</u>")).toEqual([{ text: "전부", underlined: true }]);
  });

  it("handles two separate underlined phrases in one stem", () => {
    expect(splitUnderline("<u>가</u>와 <u>나</u> 중에서")).toEqual([
      { text: "가", underlined: true },
      { text: "와 ", underlined: false },
      { text: "나", underlined: true },
      { text: " 중에서", underlined: false },
    ]);
  });

  it("treats any other bracketed text as plain, not markup — only exact <u>/</u>", () => {
    expect(splitUnderline("다음 <보기>를 참고하시오.")).toEqual([{ text: "다음 <보기>를 참고하시오.", underlined: false }]);
  });

  it("returns [] for an empty string", () => {
    expect(splitUnderline("")).toEqual([]);
  });
});

describe("stripUnderline", () => {
  it("removes the markup, keeping the plain reading", () => {
    expect(stripUnderline("어제 본 공연은 눈물이 <u>날 정도로</u> 감동적이었다.")).toBe("어제 본 공연은 눈물이 날 정도로 감동적이었다.");
  });

  it("is a no-op when there is no markup", () => {
    expect(stripUnderline("아무 표시도 없는 문장.")).toBe("아무 표시도 없는 문장.");
  });

  it("leaves other bracketed text untouched", () => {
    expect(stripUnderline("다음 <보기>를 참고하시오.")).toBe("다음 <보기>를 참고하시오.");
  });
});

describe("segmentBoundsError", () => {
  const ok = { start_ms: 1000, speech_end_ms: 20000, end_ms: 26000 };

  it("accepts timestamps that run start < speech_end < end", () => {
    expect(segmentBoundsError(ok)).toBeNull();
  });

  it("accepts speech_end exactly at end — a clip may stop talking right on the boundary", () => {
    expect(segmentBoundsError({ ...ok, speech_end_ms: 26000 })).toBeNull();
  });

  it("rejects a start at or after speech_end, so a clip can never be empty or negative", () => {
    expect(segmentBoundsError({ ...ok, start_ms: 20000 })).toContain("before speech_end_ms");
    expect(segmentBoundsError({ ...ok, start_ms: 810400 })).toContain("before speech_end_ms");
  });

  it("rejects speech_end after end", () => {
    expect(segmentBoundsError({ ...ok, speech_end_ms: 26001 })).toContain("not be after end_ms");
  });
});

describe("topikSegmentUpdateSchema", () => {
  it("still refuses an empty patch", () => {
    expect(topikSegmentUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts one timestamp on its own — only the merged row can judge it", () => {
    expect(topikSegmentUpdateSchema.safeParse({ start_ms: 810400 }).success).toBe(true);
  });

  it("rejects a pair that contradicts itself without needing the stored row", () => {
    expect(topikSegmentUpdateSchema.safeParse({ start_ms: 20000, speech_end_ms: 1000 }).success).toBe(false);
    expect(topikSegmentUpdateSchema.safeParse({ speech_end_ms: 30000, end_ms: 26000 }).success).toBe(false);
    expect(topikSegmentUpdateSchema.safeParse({ start_ms: 30000, end_ms: 26000 }).success).toBe(false);
  });
});

// M7.23: a reading question that asks WHERE a sentence belongs carries that sentence at the end
// of its own stem, after the paper's own `<보 기>` line. The question sharing its passage must not
// inherit it — these are the exact shapes from the 35회 reading paper.
describe("splitBoxedSentence", () => {
  const PASSAGE = "운전 시 안전과 직결되는 것 중의 하나가 바로 차선이다. ( ㉠ ) 야간 운전 중에… ( ㉣ )";
  const SENTENCE = "이를 방지하기 위해 야간에 차선이 잘 보이도록 반사 기능이 있는 특수한 페인트를 사용한다.";

  it("splits a stem at the paper's own box label", () => {
    expect(splitBoxedSentence(`${PASSAGE}
<보 기>
${SENTENCE}`)).toEqual({
      passage: PASSAGE,
      // The label stays with the box: it is what the exam prints, and no wording of ours would be
      // more recognisable to someone sitting it.
      boxed: `<보 기>
${SENTENCE}`,
    });
  });

  it("leaves an ordinary passage alone", () => {
    expect(splitBoxedSentence(PASSAGE)).toEqual({ passage: PASSAGE, boxed: null });
  });

  it("accepts the spellings a Korean keyboard actually produces", () => {
    for (const label of ["<보기>", "<보 기>", "〈보기〉", "＜보 기＞", "  <보  기>  "]) {
      expect(splitBoxedSentence(`${PASSAGE}
${label}
${SENTENCE}`).boxed).not.toBeNull();
    }
  });

  it("ignores 보기 written inside a sentence, not on a line of its own", () => {
    const running = "이 문제는 <보 기>를 참고해서 풀면 된다. 그러면 답이 보인다.";
    expect(splitBoxedSentence(running)).toEqual({ passage: running, boxed: null });
  });

  it("keeps a stem that is nothing but the box whole — there is no passage to share", () => {
    const only = `<보 기>
${SENTENCE}`;
    expect(splitBoxedSentence(only)).toEqual({ passage: only, boxed: null });
  });

  it("passes null and empty text straight through", () => {
    expect(splitBoxedSentence(null)).toEqual({ passage: null, boxed: null });
    expect(splitBoxedSentence("")).toEqual({ passage: null, boxed: null });
  });
});
