// Synthetic XML fixtures only — the real exam files are copyrighted and never committed
// (data/topik/ is gitignored); see scripts/topikImport for the read-only dry-run against them.
import { describe, expect, it } from "vitest";
import { parseTopikDocument } from "./topikParse";

const doc = (body: string) => `<w:document><w:body>${body}</w:body></w:document>`;
const heading = (style: string, text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
/** One table cell, optionally underlined (the convention marking the correct option). */
const cell = (text: string, underline = false, rid: string | null = null) =>
  `<w:tc><w:p><w:r>${underline ? '<w:rPr><w:u w:val="single"/></w:rPr>' : ""}<w:t>${text}</w:t></w:r>${
    rid ? `<w:r><w:drawing><a:blip r:embed="${rid}"/></w:drawing></w:r>` : ""
  }</w:p></w:tc>`;
const table = (stem: string, opts: [string, string, string, string], correct: number, stemRid: string | null = null) =>
  `<w:tbl><w:tr>${cell(stem, false, stemRid)}</w:tr><w:tr>${cell(opts[0], correct === 1)}${cell(opts[1], correct === 2)}</w:tr><w:tr>${cell(opts[2], correct === 3)}${cell(opts[3], correct === 4)}</w:tr></w:tbl>`;
const listOption = (text: string, underline = false) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r>${underline ? '<w:rPr><w:u w:val="single"/></w:rPr>' : ""}<w:t>${text}</w:t></w:r></w:p>`;
const drawing = (rid: string) => `<w:p><w:r><w:drawing><a:blip r:embed="${rid}"/></w:drawing></w:r></w:p>`;
const answer = (declared: number, serial = declared) => plain(`${serial}(${declared})`);

describe("parseTopikDocument", () => {
  it("parses a table-shape block (2 exams, 2 questions each) and cross-checks bold/underline against the label", () => {
    const xml = doc(
      heading("Heading1", "유형1: 문항 1~2") +
        heading("Heading2", "Yonsei-연습1") +
        plain("[1~2] 가장 알맞은 것을 고르십시오.") +
        heading("Heading3", "1-1") +
        answer(3) +
        table("아침에 (   ) 전화를 드렸다.", ["일어나서", "일어나는데", "일어나자마자", "일어나고"], 3) +
        heading("Heading3", "1-2") +
        answer(4) +
        table("나는 돈을 많이 (   ) 돕고 싶다.", ["벌어도", "벌거나", "벌었지만", "벌면"], 4) +
        heading("Heading2", "Yonsei-연습2") +
        plain("[1~2] 가장 알맞은 것을 고르십시오.") +
        heading("Heading3", "2-1") +
        answer(1) +
        table("stem2-1", ["a", "b", "c", "d"], 1) +
        heading("Heading3", "2-2") +
        answer(2) +
        table("stem2-2", ["a", "b", "c", "d"], 2),
    );
    const result = parseTopikDocument(xml);
    expect(result.headingBlock).toEqual({ start: 1, end: 2 });
    expect(result.warnings).toEqual([]);
    expect(result.exams).toHaveLength(2);
    expect(result.exams[0]!.exam).toBe("Yonsei-연습1");
    expect(result.exams[0]!.items).toHaveLength(2);

    const [item1, item2] = result.exams[0]!.items;
    expect(item1).toMatchObject({
      position: 1,
      labelNumber: 1,
      instruction: "[1~2] 가장 알맞은 것을 고르십시오.",
      stem_text: "아침에 (   ) 전화를 드렸다.",
      declared_correct: 3,
      errors: [],
    });
    expect(item1!.options.map((o) => o.text)).toEqual(["일어나서", "일어나는데", "일어나자마자", "일어나고"]);
    expect(item1!.options.map((o) => o.marked)).toEqual([false, false, true, false]);
    expect(item2).toMatchObject({ position: 2, labelNumber: 2, declared_correct: 4, errors: [] });
  });

  it("parses a list-shape block (image stem, no table) and finds the underlined option", () => {
    const xml = doc(
      heading("Heading1", "문항 9") +
        heading("Heading2", "연습1: Official") +
        plain("[9~12] 다음 글의 내용과 같은 것을 고르십시오.") +
        heading("Heading3", "1-9 (36회)") +
        answer(3) +
        drawing("rId9") +
        listOption("여러 나라 작가가 참여한다.") +
        listOption("사진을 볼 수 있다.") +
        listOption("관람료를 내지 않아도 된다.", true) +
        listOption("날마다 진행된다.") +
        plain("관람료: phí, tiền vé"), // a trailing vocab note must not become a 5th option
    );
    const result = parseTopikDocument(xml);
    expect(result.headingBlock).toEqual({ start: 9, end: 9 });
    const item = result.exams[0]!.items[0]!;
    expect(item).toMatchObject({ labelNumber: 9, stem_text: null, stem_image_rid: "rId9", declared_correct: 3, errors: [] });
    expect(item.options).toHaveLength(4);
    expect(item.options.map((o) => o.marked)).toEqual([false, false, true, false]);
  });

  it("flags a mismatch between the declared answer and the underlined option, without guessing", () => {
    const xml = doc(
      heading("Heading1", "문항 1") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-1") +
        answer(3) + // label says 3, but option 2 is underlined below
        table("stem", ["a", "b", "c", "d"], 2),
    );
    const item = parseTopikDocument(xml).exams[0]!.items[0]!;
    expect(item.errors).toEqual(["answer label says option 3, but option 2 is underlined"]);
  });

  it("flags a malformed answer label instead of guessing", () => {
    const xml = doc(
      heading("Heading1", "문항 1") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-1") +
        plain("2/2(2)") +
        table("stem", ["a", "b", "c", "d"], 2),
    );
    const item = parseTopikDocument(xml).exams[0]!.items[0]!;
    expect(item.errors).toContain('answer label not found or malformed (got "2/2(2)")');
  });

  it("flags zero or more than one underlined option", () => {
    const none = doc(heading("Heading1", "문항 1") + heading("Heading2", "연습1") + heading("Heading3", "1-1") + answer(1) + table("s", ["a", "b", "c", "d"], 0));
    expect(parseTopikDocument(none).exams[0]!.items[0]!.errors).toEqual(["expected exactly one underlined option, found 0 ()"]);

    const both = doc(
      heading("Heading1", "문항 1") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-1") +
        answer(1) +
        `<w:tbl><w:tr>${cell("s")}</w:tr><w:tr>${cell("a", true)}${cell("b", true)}</w:tr><w:tr>${cell("c")}${cell("d")}</w:tr></w:tbl>`,
    );
    expect(parseTopikDocument(both).exams[0]!.items[0]!.errors).toEqual(["expected exactly one underlined option, found 2 (1,2)"]);
  });

  it("the instruction repeats for every exam group it appears before, and resets per group", () => {
    const xml = doc(
      heading("Heading1", "문항 1") +
        heading("Heading2", "연습1") +
        plain("instruction A") +
        heading("Heading3", "1-1") +
        answer(1) +
        table("s", ["a", "b", "c", "d"], 1) +
        heading("Heading2", "연습2") +
        plain("instruction B") +
        heading("Heading3", "2-1") +
        answer(1) +
        table("s", ["a", "b", "c", "d"], 1),
    );
    const result = parseTopikDocument(xml);
    expect(result.exams[0]!.items[0]!.instruction).toBe("instruction A");
    expect(result.exams[1]!.items[0]!.instruction).toBe("instruction B");
  });
});
