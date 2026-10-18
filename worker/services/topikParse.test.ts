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
/** A stem-only table (1 row, no option rows) — the 11-12/16-18-style shape where the 4 options
 * are separate ListParagraph paragraphs after the table instead of more table rows. */
const stemOnlyTable = (stem: string, stemRid: string | null = null) => `<w:tbl><w:tr>${cell(stem, false, stemRid)}</w:tr></w:tbl>`;
/** A table cell holding several paragraphs (the sentence-ordering shape: one "(가)…" line each). */
const multiParaCell = (lines: string[]) => `<w:tc>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join("")}</w:tc>`;
const listOption = (text: string, underline = false) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r>${underline ? '<w:rPr><w:u w:val="single"/></w:rPr>' : ""}<w:t>${text}</w:t></w:r></w:p>`;
const drawing = (rid: string) => `<w:p><w:r><w:drawing><a:blip r:embed="${rid}"/></w:drawing></w:r></w:p>`;
/** A stem table cell whose one paragraph has several runs, some underlined — the 문항3-4 shape
 * where only part of the stem (not the whole sentence) is underlined. */
const runsCell = (runs: { text: string; underline?: boolean }[]) =>
  `<w:tc><w:p>${runs.map((r) => `<w:r>${r.underline ? '<w:rPr><w:u w:val="single"/></w:rPr>' : ""}<w:t xml:space="preserve">${r.text}</w:t></w:r>`).join("")}</w:p></w:tc>`;
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

  it("parses a stem-only table (1 row) + ListParagraph options after it (문항11-12/16-18 shape)", () => {
    const xml = doc(
      heading("Heading1", "유형3: 문항11~12") +
        heading("Heading2", "연습1(35회)") +
        heading("Heading3", "1-11(35회)") +
        answer(2) +
        stemOnlyTable("이곳에서 옛날 영화 포스터를 살 수 있다.") +
        plain("노소: già trẻ") + // a stray vocab-gloss paragraph between the table and the options
        listOption("이곳에서 옛날 영화 포스터를 살 수 있다.") +
        listOption("얼마 전 추억의 문화 공간이 새로 만들어졌다.", true) +
        listOption("추억극장은 입장료가 없기 때문에 인기가 많다.") +
        listOption("추억극장에서는 최근에 나온 영화도 볼 수 있다.") +
        plain("현실: hiện thực"), // and another one trailing after the options
    );
    const item = parseTopikDocument(xml).exams[0]!.items[0]!;
    expect(item).toMatchObject({
      labelNumber: 11,
      round: "35회",
      stem_text: "이곳에서 옛날 영화 포스터를 살 수 있다.",
      declared_correct: 2,
      errors: [],
    });
    expect(item.options).toHaveLength(4);
    expect(item.options.map((o) => o.marked)).toEqual([false, true, false, false]);
  });

  it("a stem-only table with an image keeps the image as the stem (not an option)", () => {
    const xml = doc(
      heading("Heading1", "문항 16") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-16") +
        answer(1) +
        stemOnlyTable("passage text", "rId5") +
        listOption("a", true) +
        listOption("b") +
        listOption("c") +
        listOption("d"),
    );
    const item = parseTopikDocument(xml).exams[0]!.items[0]!;
    expect(item).toMatchObject({ stem_text: "passage text", stem_image_rid: "rId5", errors: [] });
    expect(item.options).toHaveLength(4);
  });

  it("a stem-only table with fewer than 4 ListParagraph options after it still reports the real count", () => {
    const xml = doc(
      heading("Heading1", "문항 1") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-1") +
        answer(1) +
        stemOnlyTable("stem") +
        listOption("a", true) +
        listOption("b"),
    );
    const item = parseTopikDocument(xml).exams[0]!.items[0]!;
    expect(item.errors).toEqual(["expected 4 options, found 2"]);
  });

  it("joins a multi-paragraph stem cell's lines with newlines (sentence-ordering shape)", () => {
    const stemCell = multiParaCell(["(가)첫 번째 문장.", "(나)두 번째 문장.", "(다)세 번째 문장.", "(라)네 번째 문장."]);
    const xml = doc(
      heading("Heading1", "문항 13") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-13") +
        answer(1) +
        `<w:tbl><w:tr>${stemCell}</w:tr><w:tr>${cell("a", true)}${cell("b")}</w:tr><w:tr>${cell("c")}${cell("d")}</w:tr></w:tbl>`,
    );
    const item = parseTopikDocument(xml).exams[0]!.items[0]!;
    expect(item.stem_text).toBe("(가)첫 번째 문장.\n(나)두 번째 문장.\n(다)세 번째 문장.\n(라)네 번째 문장.");
    expect(item.errors).toEqual([]);
  });

  it("preserves an underlined phrase in the STEM as <u>…</u> markup (문항3-4's 'closest meaning to the underlined part'), without touching the options' own underline (which still only means 'correct answer')", () => {
    const xml = doc(
      heading("Heading1", "문항 3") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-3") +
        answer(1) +
        `<w:tbl><w:tr>${runsCell([{ text: "어제 본 공연은 눈물이 " }, { text: "날 정도로", underline: true }, { text: " 감동적이었다." }])}</w:tr><w:tr>${cell("날 만큼", true)}${cell("날까 봐")}</w:tr><w:tr>${cell("나는 대로")}${cell("나는 대신에")}</w:tr></w:tbl>`,
    );
    const item = parseTopikDocument(xml).exams[0]!.items[0]!;
    expect(item.stem_text).toBe("어제 본 공연은 눈물이 <u>날 정도로</u> 감동적이었다.");
    // The option's own underline (marking the correct answer) is a separate boolean — never
    // rewritten into <u> markup inside the option's own displayed text.
    expect(item.options.map((o) => o.text)).toEqual(["날 만큼", "날까 봐", "나는 대로", "나는 대신에"]);
    expect(item.options.map((o) => o.marked)).toEqual([true, false, false, false]);
    expect(item.errors).toEqual([]);
  });

  it("a stem with no underlined run at all has no <u> markup (unaffected — most question types)", () => {
    const xml = doc(
      heading("Heading1", "문항 1") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-1") +
        answer(1) +
        table("아침에 (   ) 전화를 드렸다.", ["a", "b", "c", "d"], 1),
    );
    const item = parseTopikDocument(xml).exams[0]!.items[0]!;
    expect(item.stem_text).toBe("아침에 (   ) 전화를 드렸다.");
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
  // A blank paragraph accidentally styled "Heading 2" is real (Cau05_08_MasterTopik has one between
  // "Master 7" and "Master 8"); counting it would shift every later group's 연습N exam label by one.
  it("does not let a Heading2 group without any question consume a group index", () => {
    const group = (label: string, n: number) =>
      heading("Heading2", label) + heading("Heading3", `1-${n}`) + answer(1) + table(`stem ${n}`, ["a", "b", "c", "d"], 1);
    const xml = doc(heading("Heading1", "문항 5~8") + group("Master 7", 7) + heading("Heading2", "") + group("Master 8", 8));

    const result = parseTopikDocument(xml);
    expect(result.exams.map((e) => [e.exam, e.groupIndex, e.items.length])).toEqual([
      ["Master 7", 1, 1],
      ["", 0, 0],
      ["Master 8", 2, 1],
    ]);
  });

  // The counter must key off file *structure*, never parse success: a group that fails to parse
  // today still owns its index, so fixing its input file tomorrow cannot renumber — and thereby
  // orphan — the groups imported after it.
  it("still counts a group whose every question fails to parse", () => {
    const broken = heading("Heading2", "Master 7") + heading("Heading3", "1-7") + plain("??") + stemOnlyTable("stem 7");
    const ok = heading("Heading2", "Master 8") + heading("Heading3", "1-8") + answer(1) + table("stem 8", ["a", "b", "c", "d"], 1);
    const result = parseTopikDocument(doc(heading("Heading1", "문항 5~8") + broken + ok));

    const [brokenExam, okExam] = result.exams;
    expect(brokenExam!.items[0]!.errors.length).toBeGreaterThan(0);
    expect(brokenExam!.groupIndex).toBe(1);
    expect(okExam!.groupIndex).toBe(2);
    expect(okExam!.items[0]!.errors).toEqual([]);
  });

});
