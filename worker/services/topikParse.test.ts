// Synthetic XML fixtures only — the real exam files are copyrighted and never committed
// (data/topik/ is gitignored); see scripts/topikImport for the read-only dry-run against them.
import { describe, expect, it } from "vitest";
import { pointsFromInstruction } from "../../shared/topik";
import { commandLikeStemLines, parseTopikDocument } from "./topikParse";

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
/** A table whose stem row is split into two cells, with a blank spacer row before the options —
 * the real review-card shape in Cau05_08_MasterTopik (연습1 #8). */
const splitStemTable = (left: string, right: string, opts: [string, string, string, string], correct: number) =>
  `<w:tbl><w:tr>${cell(left)}${cell(right)}</w:tr><w:tr>${cell("")}</w:tr><w:tr>${opts
    .map((o, i) => cell(o, correct === i + 1))
    .join("")}</w:tr></w:tbl>`;
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

  // M7.9: the label is the answer in both sections; a disagreeing underline is reported, not fatal.
  it("warns about a mismatch between the label and the underlined option, naming both", () => {
    const xml = doc(
      heading("Heading1", "문항 1") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-1") +
        answer(3) + // label says 3, but option 2 is underlined below
        table("stem", ["a", "b", "c", "d"], 2),
    );
    const item = parseTopikDocument(xml).exams[0]!.items[0]!;
    expect(item.errors).toEqual([]);
    expect(item.warnings).toEqual(["answer label says option 3, but option 2 is underlined (the label was used)"]);
    expect(item.declared_correct).toBe(3);
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

  it("warns about zero or more than one underlined option, and still imports", () => {
    const none = doc(heading("Heading1", "문항 1") + heading("Heading2", "연습1") + heading("Heading3", "1-1") + answer(1) + table("s", ["a", "b", "c", "d"], 0));
    const noneItem = parseTopikDocument(none).exams[0]!.items[0]!;
    expect(noneItem.errors).toEqual([]);
    expect(noneItem.warnings).toEqual(["answer label says option 1, but no option is underlined (the label was used)"]);

    const both = doc(
      heading("Heading1", "문항 1") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-1") +
        answer(1) +
        `<w:tbl><w:tr>${cell("s")}</w:tr><w:tr>${cell("a", true)}${cell("b", true)}</w:tr><w:tr>${cell("c")}${cell("d")}</w:tr></w:tbl>`,
    );
    const bothItem = parseTopikDocument(both).exams[0]!.items[0]!;
    expect(bothItem.errors).toEqual([]);
    expect(bothItem.warnings).toEqual(["answer label says option 1, but 2 options are underlined (1, 2) (the label was used)"]);
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

  // Both bugs below came from one real question (Cau05_08_MasterTopik 연습1 #8) that reported
  // "answer label says option 2, but option 3 is underlined" — the underline was right all along.
  describe("a stem row split into two cells, with a spacer row (M6.8)", () => {
    const xml = doc(
      heading("Heading1", "문항 5~8") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-8") +
        answer(2) +
        splitStemTable("***** 매우 만족", "가격 대비 품질이 좋네요.", ["이용 방법", "사용 후기", "문의 사항", "상품 설명"], 2),
    );

    it("keeps every cell of the stem row (the second one held half the question)", () => {
      expect(parseTopikDocument(xml).exams[0]!.items[0]!.stem_text).toBe("***** 매우 만족\n가격 대비 품질이 좋네요.");
    });

    it("ignores the blank spacer row instead of counting it as the first option", () => {
      const item = parseTopikDocument(xml).exams[0]!.items[0]!;
      expect(item.options.map((o) => o.text)).toEqual(["이용 방법", "사용 후기", "문의 사항", "상품 설명"]);
      expect(item.options.findIndex((o) => o.marked) + 1).toBe(2); // matches the "2(2)" answer label
      expect(item.errors).toEqual([]);
    });

    it("still keeps an option cell that has only an image (empty text is not the test)", () => {
      const imageOptions = `<w:tbl><w:tr>${cell("stem")}</w:tr><w:tr>${cell("")}</w:tr><w:tr>${cell("", false, "rId1")}${cell("", true, "rId2")}${cell("", false, "rId3")}${cell("", false, "rId4")}</w:tr></w:tbl>`;
      const item = parseTopikDocument(
        doc(heading("Heading1", "문항 5~8") + heading("Heading2", "연습1") + heading("Heading3", "1-5") + answer(2) + imageOptions),
      ).exams[0]!.items[0]!;
      expect(item.options.map((o) => o.image_rid)).toEqual(["rId1", "rId2", "rId3", "rId4"]);
      expect(item.errors).toEqual([]);
    });
  });

  // Real shape in Cau03_04_MasterTopik (연습6 #3): the block's instruction line is repeated inside
  // the item, above the answer label — reading the label as "the first paragraph" picked up the
  // instruction instead and reported the whole question as malformed.
  describe("the answer label is found by shape, not by position (M6.8)", () => {
    const INSTRUCTION = "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오.";
    const body = table("밑줄 친 부분", ["가", "나", "다", "라"], 4);
    const docWith = (...parts: string[]) =>
      doc(heading("Heading1", "문항 3~4") + heading("Heading2", "연습6") + plain(INSTRUCTION) + heading("Heading3", "6-3") + parts.join(""));

    it("finds it when the repeated instruction comes first", () => {
      const item = parseTopikDocument(docWith(plain(INSTRUCTION), answer(4), body)).exams[0]!.items[0]!;
      expect(item.declared_correct).toBe(4);
      expect(item.errors).toEqual([]);
    });

    it("finds it when the repeated instruction comes after the label", () => {
      const item = parseTopikDocument(docWith(answer(4), plain(INSTRUCTION), body)).exams[0]!.items[0]!;
      expect(item.declared_correct).toBe(4);
      expect(item.errors).toEqual([]);
    });

    it("keeps reporting the first paragraph when there is no label at all", () => {
      const item = parseTopikDocument(docWith(plain(INSTRUCTION), body)).exams[0]!.items[0]!;
      expect(item.declared_correct).toBeNull();
      expect(item.errors[0]).toBe(`answer label not found or malformed (got "${INSTRUCTION}")`);
    });

    // A list-shape item has no table to take its stem from, so a repeated instruction line would
    // otherwise be swallowed into the stem text now that it is no longer skipped by position.
    it("never lets a repeated instruction become part of a list-shape stem", () => {
      const listBody = plain(INSTRUCTION) + answer(2) + plain("지문입니다.") + [1, 2, 3, 4].map((n) => listOption(`${n}) 보기${n}`, n === 2)).join("");
      const item = parseTopikDocument(docWith(listBody)).exams[0]!.items[0]!;
      expect(item.stem_text).toBe("지문입니다.");
      expect(item.errors).toEqual([]);
    });
  });

  // M7.1 listening: most questions have their own audio clip, so the file marks only the minority
  // that share the previous one's. The marker is metadata — it must never reach the stem.
  describe("the CHUNG ĐOẠN marker", () => {
    const item = (extra: string) =>
      parseTopikDocument(
        doc(
          heading("Heading1", "문항 21~22") +
            heading("Heading2", "연습1") +
            heading("Heading3", "1-22") +
            answer(2) +
            extra +
            table("대화를 듣고", ["가", "나", "다", "라"], 2),
        ),
      ).exams[0]!.items[0]!;

    it("is off unless the file says so", () => {
      expect(item("").same_segment).toBe(false);
    });

    it("is read with or without Vietnamese diacritics, in any case", () => {
      for (const marker of ["CHUNG ĐOẠN", "chung đoạn", "CHUNG DOAN", "Chung Doan"]) {
        expect(item(plain(marker)).same_segment).toBe(true);
      }
    });

    it("never becomes part of the stem or an option", () => {
      const parsed = item(plain("CHUNG ĐOẠN"));
      expect(parsed.stem_text).toBe("대화를 듣고");
      expect(parsed.options.map((o) => o.text)).toEqual(["가", "나", "다", "라"]);
      expect(parsed.errors).toEqual([]);
    });
  });

  // M7.3: a pair of questions on one clip. Each asks something different, so the block-wide
  // instruction is no longer the whole prompt — and the per-question line cannot live in the stem
  // cell, which is the transcript and is hidden while the question is being answered.
  describe("a question's own question line (HỎI:)", () => {
    const pair = (secondStem: string, extra = "") =>
      parseTopikDocument(
        doc(
          heading("Heading1", "문항 21~22") +
            heading("Heading2", "연습1 (35회)") +
            plain("[21~22] 다음을 듣고 물음에 답하십시오. (각 2점)") +
            heading("Heading3", "1-21") +
            answer(2) +
            plain("HỎI: 남자의 중심 생각으로 맞는 것을 고르십시오.") +
            table("남자: 요즘 자전거로 출근해요.", ["가", "나", "다", "라"], 2) +
            heading("Heading3", "1-22") +
            answer(3) +
            plain("CHUNG ĐOẠN") +
            plain("HỎI: 들은 내용과 같은 것을 고르십시오.") +
            extra +
            table(secondStem, ["마", "바", "사", "아"], 3),
        ),
      ).exams[0]!.items;

    it("appends the question's own line under the block's, keeping the block's points", () => {
      const [first] = pair("");
      expect(first!.instruction).toBe("[21~22] 다음을 듣고 물음에 답하십시오. (각 2점)\n남자의 중심 생각으로 맞는 것을 고르십시오.");
      expect(pointsFromInstruction(first!.instruction!)).toBe(2);
    });

    it("never lets the line reach the stem or an option", () => {
      const [first] = pair("");
      expect(first!.stem_text).toBe("남자: 요즘 자전거로 출근해요.");
      expect(first!.options.map((o) => o.text)).toEqual(["가", "나", "다", "라"]);
      expect(first!.ignored).toEqual([]);
      expect(first!.errors).toEqual([]);
    });

    it("is read without diacritics and in any case", () => {
      for (const marker of ["HỎI:", "hỏi:", "HOI:", "Hoi :"]) {
        const items = parseTopikDocument(
          doc(
            heading("Heading2", "연습1") +
              heading("Heading3", "1-21") +
              answer(2) +
              plain(`${marker} 중심 생각을 고르십시오.`) +
              table("남자: 안녕", ["가", "나", "다", "라"], 2),
          ),
        ).exams[0]!.items;
        expect(items[0]!.instruction).toBe("중심 생각을 고르십시오.");
      }
    });

    // The second question is about the same recording, so it is the same transcript. Typing it
    // twice means two copies nothing compares, which drift the first time one is corrected.
    it("takes the transcript from the question it shares the clip with", () => {
      const [, second] = pair("");
      expect(second!.stem_text).toBe("남자: 요즘 자전거로 출근해요.");
      expect(second!.same_segment).toBe(true);
      expect(second!.warnings).toEqual([]);
      expect(second!.instruction).toBe("[21~22] 다음을 듣고 물음에 답하십시오. (각 2점)\n들은 내용과 같은 것을 고르십시오.");
    });

    it("keeps a second stem that is typed out, and warns when it contradicts the first", () => {
      const [, same] = pair("남자: 요즘 자전거로 출근해요.");
      expect(same!.warnings).toEqual([]);
      const [, different] = pair("남자: 어제는 버스를 탔어요.");
      expect(different!.stem_text).toBe("남자: 어제는 버스를 탔어요.");
      expect(different!.warnings).toEqual([expect.stringContaining("CHUNG ĐOẠN")]);
    });

    it("does not inherit for a question that is not marked as sharing a clip", () => {
      const items = parseTopikDocument(
        doc(
          heading("Heading2", "연습1") +
            heading("Heading3", "1-21") +
            answer(2) +
            table("남자: 안녕", ["가", "나", "다", "라"], 2) +
            heading("Heading3", "1-22") +
            answer(3) +
            table("", ["마", "바", "사", "아"], 3),
        ),
      ).exams[0]!.items;
      expect(items[1]!.stem_text).toBeNull();
    });
  });

  // M7.3: the one way a question line can still go missing. In the listening layout the transcript
  // is plain paragraphs, so a line typed without its "HỎI: " prefix is absorbed into it — and the
  // server withholds the transcript while the question is being answered, so it is invisible
  // exactly when it matters.
  describe("commandLikeStemLines", () => {
    it("spots a line that reads like the question's own instruction", () => {
      expect(commandLikeStemLines(["남자의 중심 생각으로 맞는 것을 고르십시오."])).toEqual(["남자의 중심 생각으로 맞는 것을 고르십시오."]);
      expect(commandLikeStemLines(["다음을 듣고 물음에 답하십시오"])).toHaveLength(1);
    });

    it("leaves a line of the recording alone", () => {
      expect(commandLikeStemLines(["남자 : 현아 씨가 세계여행을 간대요.", "여자 : 저도 들었어요."])).toEqual([]);
    });

    // Reading questions 5-8 quote notices and medicine labels, which are written as orders. The
    // broad rule ("anything ending in 십시오") flagged 11 real stems, every one a false alarm.
    it("leaves a stem that is itself a notice alone", () => {
      expect(
        commandLikeStemLines(["1회 2정 이상 복용하지 마십시오.", "포장지를 뜯지 말고 냉장고에 두십시오.", "감기에 걸리지 않도록 조심하십시오."]),
      ).toEqual([]);
    });

    it("still spots one even when a speaker says it, since it cannot tell", () => {
      // Deliberately a warning and never an error: the file may be right and we cannot know.
      expect(commandLikeStemLines(["알맞은 것을 고르십시오"])).toHaveLength(1);
    });
  });

  describe("an unprefixed question line in a listening transcript", () => {
    const listening = (first: string) =>
      parseTopikDocument(
        doc(
          heading("Heading2", "35회") +
            plain("[21~22] 다음을 듣고 물음에 답하십시오. (각 2점)") +
            heading("Heading3", "21") +
            answer(1) +
            plain(first) +
            plain("남자 : 현아 씨가 세계여행을 간대요.") +
            listOption("가", true) +
            listOption("나") +
            listOption("다") +
            listOption("라"),
        ),
      ).exams[0]!.items[0]!;

    it("warns, quotes the line, and still imports the question", () => {
      const item = listening("남자의 중심 생각으로 맞는 것을 고르십시오.");
      expect(item.errors).toEqual([]);
      expect(item.warnings).toEqual([expect.stringContaining('HỎI: ')]);
      expect(item.warnings[0]).toContain("남자의 중심 생각으로 맞는 것을 고르십시오.");
    });

    it("says nothing when the line carries its prefix", () => {
      const item = listening("HỎI: 남자의 중심 생각으로 맞는 것을 고르십시오.");
      expect(item.warnings).toEqual([]);
      expect(item.stem_text).toBe("남자 : 현아 씨가 세계여행을 간대요.");
    });
  });

  // M7.3, the rule behind the other two: nothing typed into a question may be dropped in silence.
  // Three separate losses of real work went unnoticed exactly that way.
  describe("paragraphs nothing used", () => {
    const withStray = (extra: string, afterTable = "") =>
      parseTopikDocument(
        doc(
          heading("Heading2", "연습1") +
            plain("[1~2] 가장 알맞은 것을 고르십시오.") +
            heading("Heading3", "1-1") +
            answer(2) +
            extra +
            table("문제", ["가", "나", "다", "라"], 2) +
            afterTable,
        ),
      ).exams[0]!.items[0]!;

    it("reports a stray paragraph before the question, verbatim", () => {
      expect(withStray(plain("남자의 중심 생각으로 맞는 것을 고르십시오.")).ignored).toEqual([
        { text: "남자의 중심 생각으로 맞는 것을 고르십시오.", after_options: false },
      ]);
    });

    it("marks a paragraph after the options as the file author's own note", () => {
      expect(withStray("", plain("관람료: phí, tiền vé")).ignored).toEqual([{ text: "관람료: phí, tiền vé", after_options: true }]);
    });

    it("says nothing about the metadata it is supposed to consume", () => {
      expect(withStray(plain("CHUNG ĐOẠN") + plain("HỎI: 알맞은 것을 고르십시오.") + plain("[1~2] 가장 알맞은 것을 고르십시오.")).ignored).toEqual([]);
    });

    it("ignores an empty paragraph", () => {
      expect(withStray(plain("")).ignored).toEqual([]);
    });

    // A file can start a new block part way through a group: "[3~4] …" typed inside question 3 of
    // a group headed "[1~2] …" (Cau03_04_MasterTopik). That line was dropped until M7.3.
    it("uses a block instruction typed inside a question, for it and the rest of the group", () => {
      const items = parseTopikDocument(
        doc(
          heading("Heading2", "연습1") +
            plain("[1~2] (   )에 들어갈 것을 고르십시오.") +
            heading("Heading3", "1-1") +
            answer(1) +
            table("문제1", ["가", "나", "다", "라"], 1) +
            heading("Heading3", "1-3") +
            answer(2) +
            plain("[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오.") +
            table("문제3", ["가", "나", "다", "라"], 2) +
            heading("Heading3", "1-4") +
            answer(3) +
            table("문제4", ["가", "나", "다", "라"], 3),
        ),
      ).exams[0]!.items;
      expect(items.map((i) => i.instruction)).toEqual([
        "[1~2] (   )에 들어갈 것을 고르십시오.",
        "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오.",
        "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오.",
      ]);
      expect(items.every((i) => i.ignored.length === 0)).toBe(true);
    });
  });

  // M7.1 listening questions 1~3: four pictures, no words. Nothing can be underlined, so the
  // answer label is the only source of truth — and it has to actually be there.
  describe("four picture options", () => {
    const pictureTable = (rids: [string, string, string, string]) =>
      `<w:tbl><w:tr>${cell("여자: 이거 좀 봐 주실래요?")}</w:tr>` +
      `<w:tr>${cell("", false, rids[0])}${cell("", false, rids[1])}</w:tr>` +
      `<w:tr>${cell("", false, rids[2])}${cell("", false, rids[3])}</w:tr></w:tbl>`;
    const item = (body: string) =>
      parseTopikDocument(doc(heading("Heading1", "문항 1~3") + heading("Heading2", "35회") + heading("Heading3", "1") + body)).exams[0]!.items[0]!;

    it("takes the answer from the label when no option carries any text", () => {
      const parsed = item(answer(2) + pictureTable(["rId1", "rId2", "rId3", "rId4"]));
      expect(parsed.errors).toEqual([]);
      expect(parsed.declared_correct).toBe(2);
      expect(parsed.options.map((o) => o.image_rid)).toEqual(["rId1", "rId2", "rId3", "rId4"]);
    });

    it("refuses the question when the label is missing, rather than guessing an answer", () => {
      const parsed = item(pictureTable(["rId1", "rId2", "rId3", "rId4"]));
      expect(parsed.declared_correct).toBeNull();
      expect(parsed.errors.join(" ")).toContain("no answer label");
    });

    it("refuses an answer outside 1-4", () => {
      const parsed = item(plain("5(5)") + pictureTable(["rId1", "rId2", "rId3", "rId4"]));
      expect(parsed.errors.join(" ")).toContain("not between 1 and 4");
    });

    // One option with words means an underline is possible again, so its absence is worth a word
    // — a word, not a refusal (M7.9).
    it("mentions the missing underline as soon as one option has text", () => {
      const mixed =
        `<w:tbl><w:tr>${cell("지문")}</w:tr>` +
        `<w:tr>${cell("", false, "rId1")}${cell("", false, "rId2")}</w:tr>` +
        `<w:tr>${cell("", false, "rId3")}${cell("사진 아님", false, "rId4")}</w:tr></w:tbl>`;
      const parsed = item(answer(2) + mixed);
      expect(parsed.errors).toEqual([]);
      expect(parsed.warnings.join(" ")).toContain("no option is underlined");
    });

    it("still rejects a picture question that does not have exactly four options", () => {
      const three = `<w:tbl><w:tr>${cell("지문")}</w:tr><w:tr>${cell("", false, "rId1")}${cell("", false, "rId2")}${cell("", false, "rId3")}</w:tr></w:tbl>`;
      expect(item(answer(2) + three).errors.join(" ")).toContain("expected 4 options, found 3");
    });
  });

  // M7.10: Word keeps the formatting of a paragraph's own end mark in <w:pPr><w:rPr>, and an
  // underline there is invisible on screen — there is nothing to draw a line under. Counting it
  // reported all four options of a question as underlined (measured on 36회 #5: option 1 had 10
  // underlined runs, options 2-4 had none, and every one of them carried that mark).
  describe("an underline on the paragraph mark is not a mark on the answer", () => {
    /** A cell whose paragraph mark is underlined, but whose text is not. */
    const markOnlyCell = (text: string) =>
      `<w:tc><w:p><w:pPr><w:rPr><w:u w:val="single"/></w:rPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const item = (optionCells: string) =>
      parseTopikDocument(
        doc(
          heading("Heading1", "문항 1") +
            heading("Heading2", "연습1") +
            heading("Heading3", "1-1") +
            answer(1) +
            `<w:tbl><w:tr>${cell("지문")}</w:tr><w:tr>${optionCells}</w:tr></w:tbl>`,
        ),
      ).exams[0]!.items[0]!;

    it("ignores it, so a question is not reported as having every option underlined", () => {
      const parsed = item(cell("가", true) + markOnlyCell("나") + markOnlyCell("다") + markOnlyCell("라"));
      expect(parsed.options.map((o) => o.marked)).toEqual([true, false, false, false]);
      expect(parsed.warnings).toEqual([]);
    });

    it("reads a real underline on the text as before", () => {
      expect(item(cell("가") + cell("나", true) + cell("다") + cell("라")).options.map((o) => o.marked)).toEqual([false, true, false, false]);
    });

    it("does not count an underlined run that holds only spaces", () => {
      const spaceOnly = `<w:tc><w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">  </w:t></w:r><w:r><w:t>나</w:t></w:r></w:p></w:tc>`;
      expect(item(cell("가", true) + spaceOnly + cell("다") + cell("라")).options.map((o) => o.marked)).toEqual([true, false, false, false]);
    });
  });

  // The N(N) label is the answer in both sections (M7.1 for listening, M7.9 everywhere). These
  // files are typed up from a PDF and the underline bleeds across options constantly; treating it
  // as authoritative rejected more good questions than it caught bad ones.
  describe("the answer comes from the label, not the underline", () => {
    const listening = (body: string) =>
      parseTopikDocument(
        doc(heading("Heading1", "문항 4~8") + heading("Heading2", "35회") + heading("Heading3", "4") + body),
      ).exams[0]!.items[0]!;
    const reading = (body: string) =>
      parseTopikDocument(doc(heading("Heading1", "문항 1~2") + heading("Heading2", "연습1") + heading("Heading3", "1-1") + body)).exams[0]!.items[0]!;
    const opts: [string, string, string, string] = ["가", "나", "다", "라"];

    it("imports a question with no underline at all, saying so", () => {
      const parsed = listening(answer(2) + table("지문", opts, 0));
      expect(parsed.errors).toEqual([]);
      expect(parsed.warnings).toEqual(["answer label says option 2, but no option is underlined (the label was used)"]);
      expect(parsed.declared_correct).toBe(2);
    });

    it("accepts several underlined options without a word, since that is formatting bleed", () => {
      const bleed = `<w:tbl><w:tr>${cell("지문")}</w:tr><w:tr>${cell("가", true)}${cell("나", true)}</w:tr><w:tr>${cell("다", true)}${cell("라", true)}</w:tr></w:tbl>`;
      const parsed = listening(answer(3) + bleed);
      expect(parsed.errors).toEqual([]);
      expect(parsed.warnings).toEqual(["answer label says option 3, but 4 options are underlined (1, 2, 3, 4) (the label was used)"]);
      expect(parsed.declared_correct).toBe(3);
    });

    // One underline that disagrees is a real contradiction: imported, but worth a look.
    it("warns — without rejecting — when the single underline disagrees with the label", () => {
      const parsed = listening(answer(2) + table("지문", opts, 4));
      expect(parsed.errors).toEqual([]);
      expect(parsed.warnings.join(" ")).toContain("option 4 is underlined");
      expect(parsed.declared_correct).toBe(2);
    });

    it("says nothing when the single underline agrees", () => {
      expect(listening(answer(2) + table("지문", opts, 2)).warnings).toEqual([]);
    });

    it("still rejects a missing label, an answer outside 1-4, and the wrong option count", () => {
      expect(listening(table("지문", opts, 0)).errors.join(" ")).toContain("no answer label");
      expect(listening(plain("5(5)") + table("지문", opts, 0)).errors.join(" ")).toContain("not between 1 and 4");
      const three = `<w:tbl><w:tr>${cell("지문")}</w:tr><w:tr>${cell("가")}${cell("나")}</w:tr><w:tr>${cell("다")}</w:tr></w:tbl>`;
      expect(listening(answer(2) + three).errors.join(" ")).toContain("expected 4 options, found 3");
    });

    // The point of M7.9: reading now follows the very same rule instead of its own stricter one.
    it("treats reading exactly the same way", () => {
      const noUnderline = reading(answer(2) + table("지문", opts, 0));
      expect(noUnderline.errors).toEqual([]);
      expect(noUnderline.warnings.join(" ")).toContain("no option is underlined");
      const disagreeing = reading(answer(2) + table("지문", opts, 4));
      expect(disagreeing.errors).toEqual([]);
      expect(disagreeing.warnings.join(" ")).toContain("answer label says option 2, but option 4 is underlined");
    });

    // The one hard error left: no label, no answer. Nothing is ever inferred from an underline.
    it("still refuses a question with no label, in either section", () => {
      expect(reading(table("지문", opts, 2)).errors.join(" ")).toContain("no answer label");
      expect(listening(table("지문", opts, 2)).errors.join(" ")).toContain("no answer label");
    });
  });

});
