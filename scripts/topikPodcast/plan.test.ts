import { describe, expect, it } from "vitest";
import { charactersPerQuestion, planSpeech, totalCharacters, type PodcastRow } from "./plan";

const row = (number: number, over: Partial<PodcastRow> = {}): PodcastRow => ({
  id: `q${number}`,
  exam: "Listen-60회",
  number,
  instruction: "[4~8] 다음 대화를 잘 듣고 이어질 수 있는 말을 고르십시오. (각 2점)",
  options: [
    { text: "학교에 가요.", image_key: null },
    { text: "집에 있어요.", image_key: null },
    { text: "밥을 먹어요.", image_key: null },
    { text: "친구를 만나요.", image_key: null },
  ],
  correct_option: 2,
  ...over,
});

describe("planSpeech", () => {
  it("makes four files for one question", () => {
    expect(planSpeech([row(4)]).items).toHaveLength(4);
  });

  it("shares the question line and the number across papers, which is most of the saving", () => {
    const other = row(4, {
      id: "q4b",
      exam: "Listen-64회",
      options: [
        { text: "네, 그래요.", image_key: null },
        { text: "아니요, 괜찮아요.", image_key: null },
        { text: "지금 갈게요.", image_key: null },
        { text: "내일 만나요.", image_key: null },
      ],
    });
    const { items } = planSpeech([row(4), other]);
    // Two papers, same number and same block instruction: 2 shared + 2 × 2 of their own.
    expect(items).toHaveLength(6);
    expect(items.filter((i) => i.questions === 2)).toHaveLength(2);
    expect(totalCharacters(items)).toBeLessThan(charactersPerQuestion([row(4), other]));
  });

  it("makes nothing for questions 1-3, whose options are pictures", () => {
    const { items, skipped } = planSpeech([row(1), row(2), row(3)]);
    expect(items).toHaveLength(0);
    expect(skipped.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it("makes nothing for a question that cannot be spoken whole", () => {
    const noLine = planSpeech([row(9, { instruction: null })]);
    expect(noLine.items).toHaveLength(0);
    expect(noLine.skipped).toHaveLength(1);

    const [, o2, o3, o4] = row(9).options;
    const picture = planSpeech([row(9, { options: [{ text: null, image_key: "k" }, o2, o3, o4] })]);
    expect(picture.items).toHaveLength(0);
  });
});
