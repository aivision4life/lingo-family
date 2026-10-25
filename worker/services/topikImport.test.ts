import { describe, expect, it } from "vitest";
import { buildImportDraft, parseTopikFileName } from "./topikImport";

describe("parseTopikFileName", () => {
  it("parses a range file name", () => {
    expect(parseTopikFileName("TOPIK_Reading_Cau01_02_Yonsei_VERSION1.docx")).toEqual({ section: "reading", start: 1, end: 2, source: "Yonsei" });
  });

  it("parses a single-number file name", () => {
    expect(parseTopikFileName("TOPIK_Reading_Cau09_8DeOfficial_VERSION1.docx")).toEqual({
      section: "reading",
      start: 9,
      end: 9,
      source: "8DeOfficial",
    });
  });

  // M7.1: the same convention with "Listening" in place of "Reading".
  it("parses a listening file name", () => {
    expect(parseTopikFileName("TOPIK_Listening_Cau01_03_8DeOfficial_VERSION1.docx")).toEqual({
      section: "listening",
      start: 1,
      end: 3,
      source: "8DeOfficial",
    });
  });

  it("returns null for a name that does not match the convention", () => {
    expect(parseTopikFileName("random.docx")).toBeNull();
    expect(parseTopikFileName("TOPIK_Writing_Cau01_Yonsei_VERSION1.docx")).toBeNull();
  });
});

const doc = (body: string) => `<w:document><w:body>${body}</w:body></w:document>`;
const heading = (style: string, text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string, underline = false) =>
  `<w:tc><w:p><w:r>${underline ? '<w:rPr><w:u w:val="single"/></w:rPr>' : ""}<w:t>${text}</w:t></w:r></w:p></w:tc>`;
const table = (stem: string, opts: [string, string, string, string], correct: number) =>
  `<w:tbl><w:tr>${cell(stem)}</w:tr><w:tr>${cell(opts[0], correct === 1)}${cell(opts[1], correct === 2)}</w:tr><w:tr>${cell(opts[2], correct === 3)}${cell(opts[3], correct === 4)}</w:tr></w:tbl>`;
const answer = (n: number) => plain(`${n}(${n})`);
const question = (label: string, correct: number) =>
  heading("Heading3", label) + answer(correct) + table(`stem ${label}`, ["a", "b", "c", "d"], correct);

describe("buildImportDraft", () => {
  it("computes the real question number from the file name's block + position, not the label text", () => {
    const xml = doc(
      heading("Heading1", "유형1: 문항 3~4") +
        heading("Heading2", "연습1") +
        question("1-3", 1) +
        question("1-4", 2) +
        heading("Heading2", "연습2") +
        question("2-3", 3) +
        question("2-4", 4),
    );
    const draft = buildImportDraft("TOPIK_Reading_Cau03_04_Yonsei_VERSION1.docx", xml);
    expect(draft.errors).toEqual([]);
    expect(draft.block).toBe("3~4");
    expect(draft.questions.map((q) => [q.exam, q.number, q.correct_option])).toEqual([
      ["Yonsei-연습1", 3, 1],
      ["Yonsei-연습1", 4, 2],
      ["Yonsei-연습2", 3, 3],
      ["Yonsei-연습2", 4, 4],
    ]);
  });

  it("uses a single number for a one-question block (e.g. Cau09)", () => {
    const xml = doc(heading("Heading1", "문항 9") + heading("Heading2", "연습1") + question("1-9", 2));
    const draft = buildImportDraft("TOPIK_Reading_Cau09_8DeOfficial_VERSION1.docx", xml);
    expect(draft.block).toBe("9");
    expect(draft.questions).toEqual([
      expect.objectContaining({ exam: "8DeOfficial-연습1", number: 9, correct_option: 2 }),
    ]);
  });

  it("keeps items from the same Heading2 group that come from different real exam rounds apart (M6.1 bug: Cau09/Cau10 silently dropped 12 of 14 image questions)", () => {
    const xml = doc(
      heading("Heading1", "문항 9") +
        heading("Heading2", "연습1: Official") +
        question("1-9 (36회)", 1) +
        question("1-9 (37회)", 2) +
        question("1-9 (41회)", 3),
    );
    const draft = buildImportDraft("TOPIK_Reading_Cau09_8DeOfficial_VERSION1.docx", xml);
    expect(draft.errors).toEqual([]);
    // All 3 map to the same question number (9, single-question block) but must stay 3 distinct rows.
    expect(draft.questions.map((q) => [q.exam, q.number])).toEqual([
      ["8DeOfficial-36회", 9],
      ["8DeOfficial-37회", 9],
      ["8DeOfficial-41회", 9],
    ]);
    expect(new Set(draft.questions.map((q) => q.exam)).size).toBe(3);
  });

  it("the real exam round, not the 연습N group index, is the exam identity when the label has one — so questions from the same real exam but different files/블록 share one label (a mock test can then pull one whole exam back out)", () => {
    // Simulates Cau01_04's "연습2 (36회)" (4 questions, block 1~4) and Cau09's "연습1: Official"
    // single-question item that also happens to be round 36회 (block 9) — two different files,
    // two different Heading2 group indexes, but the SAME real exam (36회).
    const xmlBlock1to4 = doc(
      heading("Heading1", "유형1: 문항 1~4") +
        heading("Heading2", "연습1 (35회)") +
        question("1-1 (35회)", 1) +
        heading("Heading2", "연습2 (36회)") +
        question("1-1 (36회)", 2),
    );
    const xmlBlock9 = doc(heading("Heading1", "문항 9") + heading("Heading2", "연습1: Official") + question("1-9 (36회)", 3));
    const a = buildImportDraft("TOPIK_Reading_Cau01_04_8DeOfficial_VERSION1.docx", xmlBlock1to4);
    const b = buildImportDraft("TOPIK_Reading_Cau09_8DeOfficial_VERSION1.docx", xmlBlock9);
    const round36FromA = a.questions.find((q) => q.number === 1 && q.exam === "8DeOfficial-36회");
    expect(round36FromA).toBeDefined();
    expect(b.questions[0]).toMatchObject({ exam: "8DeOfficial-36회", number: 9 });
  });

  it("without a round, the 연습N group index is the exam identity, and the counter restarting in each file correctly merges matching groups across files (Cau01_02's 연습1 + Cau03_04's 연습1 → one 'Yonsei-연습1' label)", () => {
    const xmlA = doc(heading("Heading1", "유형1: 문항 1~2") + heading("Heading2", "연습1") + question("1-1", 1));
    const xmlB = doc(heading("Heading1", "유형1: 문항 3~4") + heading("Heading2", "연습1") + question("1-3", 1));
    const a = buildImportDraft("TOPIK_Reading_Cau01_02_Yonsei_VERSION1.docx", xmlA);
    const b = buildImportDraft("TOPIK_Reading_Cau03_04_Yonsei_VERSION1.docx", xmlB);
    expect(a.questions[0]).toMatchObject({ exam: "Yonsei-연습1", number: 1 });
    expect(b.questions[0]).toMatchObject({ exam: "Yonsei-연습1", number: 3 });
  });

  // Real bug: Cau05_08_MasterTopik has a blank paragraph styled "Heading 2" before "Master 8", which
  // made its 5~8 questions land on 연습9/10/11 while 연습8 stayed stuck without them.
  it("a blank Heading2 paragraph does not shift the 연습N label of the groups after it", () => {
    const xml = doc(
      heading("Heading1", "유형2: 문항 5~8") +
        heading("Heading2", "Master 7") +
        question("1-5", 1) +
        heading("Heading2", "") +
        heading("Heading2", "Master 8") +
        question("1-5", 2),
    );
    const draft = buildImportDraft("TOPIK_Reading_Cau05_08_MasterTopik_VERSION1.docx", xml);
    expect(draft.questions.map((q) => q.exam)).toEqual(["MasterTopik-연습1", "MasterTopik-연습2"]);
  });

  // The index must come from file structure, not from parse success, or a group's label would move
  // the day its input file is fixed — orphaning everything already imported under the old label.
  it("a group whose questions all fail to parse keeps its 연습N slot, so later groups do not renumber", () => {
    const broken = heading("Heading2", "Master 7") + heading("Heading3", "1-5") + plain("??") + table("stem", ["a", "b", "c", "d"], 0);
    const xml = doc(heading("Heading1", "유형2: 문항 5~8") + broken + heading("Heading2", "Master 8") + question("1-5", 2));
    const draft = buildImportDraft("TOPIK_Reading_Cau05_08_MasterTopik_VERSION1.docx", xml);
    expect(draft.errors.length).toBeGreaterThan(0);
    expect(draft.questions.map((q) => q.exam)).toEqual(["MasterTopik-연습2"]);
  });

  // The 문항 1~4 reading fixes (merged block label + the fixed "밑줄 친 부분" instruction) must not
  // follow questions 1~4 of the listening paper, where those numbers are a different task.
  it("never applies the reading-only 1~4 block/instruction fixes to a listening file", () => {
    const xml = doc(
      heading("Heading1", "유형1: 문항 1~4") +
        heading("Heading2", "연습1") +
        plain("[1~4] 다음을 듣고 알맞은 그림을 고르십시오.") +
        question("1-3", 2),
    );
    const draft = buildImportDraft("TOPIK_Listening_Cau01_04_Yonsei_VERSION1.docx", xml);
    expect(draft.questions[0]).toMatchObject({
      section: "listening",
      // Reading would have forced block "1~2" on question 1 here; listening keeps the file's own.
      number: 1,
      block: "1~4",
      instruction: "[1~4] 다음을 듣고 알맞은 그림을 고르십시오.",
    });
  });

  it("two different source files never collide even with identical, generic exam group text", () => {
    const xmlA = doc(heading("Heading1", "문항 1") + heading("Heading2", "연습1") + question("1-1", 1));
    const xmlB = doc(heading("Heading1", "문항 1") + heading("Heading2", "연습1") + question("1-1", 1));
    const a = buildImportDraft("TOPIK_Reading_Cau01_SourceA_VERSION1.docx", xmlA);
    const b = buildImportDraft("TOPIK_Reading_Cau01_SourceB_VERSION1.docx", xmlB);
    expect(a.questions[0]!.exam).not.toBe(b.questions[0]!.exam);
  });

  it("warns (but still imports) when the heading's own block disagrees with the file name", () => {
    const xml = doc(heading("Heading1", "문항 9") /* file name says 10 */ + heading("Heading2", "연습1") + question("1-10", 1));
    const draft = buildImportDraft("TOPIK_Reading_Cau10_8DeOfficial_VERSION1.docx", xml);
    expect(draft.questions).toHaveLength(1);
    expect(draft.warnings.some((w) => w.includes("heading says block 9~9, file name says 10~10"))).toBe(true);
  });

  it("sets the question's own `warning` field when its label disagrees with the computed number", () => {
    const xml = doc(heading("Heading1", "문항 1") + heading("Heading2", "연습1") + question("1-5" /* should be 1 */, 1));
    const draft = buildImportDraft("TOPIK_Reading_Cau01_8DeOfficial_VERSION1.docx", xml);
    expect(draft.questions[0]!.warning).toBe("label says question 5, computed 1 (computed is used)");
  });

  it("errors (and still imports the rest) when a question's own label disagrees with its answer", () => {
    const xml = doc(
      heading("Heading1", "문항 1") +
        heading("Heading2", "연습1") +
        heading("Heading3", "1-1") +
        plain("2/2(2)") + // malformed label → this item is dropped
        table("s", ["a", "b", "c", "d"], 2) +
        question("1-1", 3), // a second, well-formed item still gets imported
    );
    const draft = buildImportDraft("TOPIK_Reading_Cau01_8DeOfficial_VERSION1.docx", xml);
    expect(draft.errors).toHaveLength(1);
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0]!.correct_option).toBe(3);
  });

  it("splits a legacy merged block ('1~4', one file covering both pairs) into '1~2'/'3~4' by question number, and gives 3/4 the fixed 문항3-4 instruction regardless of whatever the file itself says (M6.5-ish: real files either never repeat it per round, or — Yonsei — never have the right text at all)", () => {
    const xml = doc(
      heading("Heading1", "유형1: 문항 1~4") +
        heading("Heading2", "연습1") +
        plain("[1~2] (   )에 들어갈 가장 알맞은 것을 고르십시오.") +
        question("1-1", 1) +
        question("1-2", 2) +
        question("1-3", 3) +
        question("1-4", 4),
    );
    const draft = buildImportDraft("TOPIK_Reading_Cau01_04_8DeOfficial_VERSION1.docx", xml);
    expect(draft.errors).toEqual([]);
    expect(draft.questions.map((q) => [q.number, q.block, q.instruction])).toEqual([
      [1, "1~2", "[1~2] (   )에 들어갈 가장 알맞은 것을 고르십시오."],
      [2, "1~2", "[1~2] (   )에 들어갈 가장 알맞은 것을 고르십시오."],
      [3, "3~4", "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오."],
      [4, "3~4", "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오."],
    ]);
  });

  it("the fixed 3-4 instruction applies the same way to an already-single-pair file (future imports), not just the legacy merged one", () => {
    const xml = doc(heading("Heading1", "유형1: 문항 3~4") + heading("Heading2", "연습1") + question("1-3", 1) + question("1-4", 2));
    const draft = buildImportDraft("TOPIK_Reading_Cau03_04_Yonsei_VERSION1.docx", xml);
    expect(draft.questions.every((q) => q.instruction === "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오." && q.block === "3~4")).toBe(true);
  });

  it("does not touch the block/instruction of a question outside 1-4 (e.g. 문항 9)", () => {
    const xml = doc(heading("Heading1", "문항 9") + heading("Heading2", "연습1") + question("1-9", 2));
    const draft = buildImportDraft("TOPIK_Reading_Cau09_8DeOfficial_VERSION1.docx", xml);
    expect(draft.questions[0]).toMatchObject({ block: "9", instruction: null });
  });

  it("rejects a file name that does not follow the naming convention", () => {
    const draft = buildImportDraft("random.docx", doc(""));
    expect(draft.errors).toEqual(['file name does not match "TOPIK_(Reading|Listening)_Cau<N>[_<M>]_<source>_VERSION<v>.docx"']);
    expect(draft.questions).toEqual([]);
  });
});
