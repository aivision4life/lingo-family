import { describe, expect, it } from "vitest";
import { splitUnderline, stripUnderline } from "./topik";

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
