import { describe, expect, it } from "vitest";
import {
  podcastAnswerText,
  podcastClipEnd,
  podcastOptionsText,
  podcastQuestionLineText,
  podcastSpeech,
  podcastSpeechLength,
} from "./podcast";

const options = [{ text: "기다리게 해서 죄송합니다." }, { text: "내일은 꼭 나가겠습니다." }, { text: "감기에 걸렸어요." }, { text: "전화 드리겠습니다." }];

describe("podcastQuestionLineText", () => {
  it("drops the block and the points, which are printed for the eye only", () => {
    expect(podcastQuestionLineText("[4~8] 다음 대화를 잘 듣고 이어질 수 있는 말을 고르십시오. (각 2점)")).toBe(
      "다음 대화를 잘 듣고 이어질 수 있는 말을 고르십시오.",
    );
  });
  it("leaves a line that has neither", () => {
    expect(podcastQuestionLineText("남자의 중심 생각으로 맞는 것을 고르십시오.")).toBe("남자의 중심 생각으로 맞는 것을 고르십시오.");
  });
  it("is null when there is nothing left to read", () => {
    expect(podcastQuestionLineText(null)).toBeNull();
    expect(podcastQuestionLineText("[21~22] (각 2점)")).toBeNull();
  });
});

describe("podcastOptionsText", () => {
  it("numbers the four options in Korean", () => {
    expect(podcastOptionsText(options)).toBe(
      "1번. 기다리게 해서 죄송합니다. 2번. 내일은 꼭 나가겠습니다. 3번. 감기에 걸렸어요. 4번. 전화 드리겠습니다.",
    );
  });
  it("refuses a picture option rather than reading three of four", () => {
    expect(podcastOptionsText([{ text: "가" }, { text: null }, { text: "다" }, { text: "라" }])).toBeNull();
  });
});

describe("podcastAnswerText", () => {
  it("announces the number and reads the option twice (F13)", () => {
    expect(podcastAnswerText(2, options)).toBe("정답은 2번. 내일은 꼭 나가겠습니다. 내일은 꼭 나가겠습니다.");
  });
  it("is null when the correct option has no text", () => {
    expect(podcastAnswerText(5, options)).toBeNull();
    expect(podcastAnswerText(1, [{ text: null }, ...options.slice(1)])).toBeNull();
  });
});

describe("podcastSpeech", () => {
  const q = { number: 4, instruction: "[4~8] 다음 대화를 잘 듣고 이어질 수 있는 말을 고르십시오. (각 2점)", options, correct_option: 2 };

  it("builds the four files a question needs", () => {
    const speech = podcastSpeech(q)!;
    expect(speech.number).toBe("4번.");
    expect(speech.questionLine.startsWith("다음 대화를")).toBe(true);
    expect(speech.answer.startsWith("정답은 2번.")).toBe(true);
    // Roughly F13's estimate of ~210 characters a question; far from it would mean a wrong text.
    expect(podcastSpeechLength(speech)).toBeGreaterThan(100);
    expect(podcastSpeechLength(speech)).toBeLessThan(400);
  });

  it("is null when any part cannot be spoken, so the question is left out whole", () => {
    expect(podcastSpeech({ ...q, instruction: null })).toBeNull();
    expect(podcastSpeech({ ...q, options: [{ text: "가" }, { text: null }, { text: "다" }, { text: "라" }] })).toBeNull();
  });
});

describe("podcastClipEnd", () => {
  it("stops a breath after the last word, not at the end of the answering silence", () => {
    // 36회 question 4: the speech ends at 235.288 s and the paper's clip runs to 252.747 s, which
    // is exactly where the tape says "5번" — the podcast must be long gone by then.
    expect(podcastClipEnd({ start_ms: 208_461, speech_end_ms: 235_288, end_ms: 252_747 })).toBe(236_088);
  });

  it("never plays past the paper's own end, however short the silence", () => {
    expect(podcastClipEnd({ start_ms: 0, speech_end_ms: 9_900, end_ms: 10_000 })).toBe(10_000);
    expect(podcastClipEnd({ start_ms: 0, speech_end_ms: 10_000, end_ms: 10_000 })).toBe(10_000);
  });

  it("keeps exactly the tail when there is room for it", () => {
    expect(podcastClipEnd({ start_ms: 0, speech_end_ms: 9_200, end_ms: 10_000 })).toBe(10_000);
    expect(podcastClipEnd({ start_ms: 0, speech_end_ms: 9_199, end_ms: 10_000 })).toBe(9_999);
    expect(podcastClipEnd({ start_ms: 0, speech_end_ms: 5_000, end_ms: 30_000 })).toBe(5_800);
  });

  it("cannot end before the clip starts, whatever the data says", () => {
    expect(podcastClipEnd({ start_ms: 5_000, speech_end_ms: 1_000, end_ms: 2_000 })).toBe(5_000);
  });
});
