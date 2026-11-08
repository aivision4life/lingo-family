import { describe, expect, it } from "vitest";
import { segmentBoundsError, splitUnderline, stripUnderline, topikSegmentUpdateSchema } from "./topik";

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
