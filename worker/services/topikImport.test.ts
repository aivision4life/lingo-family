import { describe, expect, it } from "vitest";
import {
  assignGroupKeys,
  blockRangeOf,
  buildImportDraft,
  driftNotes,
  hasOptionNumber,
  parseTopikFileName,
  stripOptionNumber,
  wrappedTranscriptLines,
} from "./topikImport";

describe("parseTopikFileName", () => {
  it("parses a range file name", () => {
    expect(parseTopikFileName("TOPIK_Reading_Cau01_02_Yonsei_VERSION1.docx")).toEqual({ kind: "block", section: "reading", start: 1, end: 2, source: "Yonsei" });
  });

  it("parses a single-number file name", () => {
    expect(parseTopikFileName("TOPIK_Reading_Cau09_8DeOfficial_VERSION1.docx")).toEqual({
      kind: "block",
      section: "reading",
      start: 9,
      end: 9,
      source: "8DeOfficial",
    });
  });

  // M7.1: the same convention with "Listening" in place of "Reading".
  it("parses a listening file name", () => {
    expect(parseTopikFileName("TOPIK_Listening_Cau01_03_8DeOfficial_VERSION1.docx")).toEqual({
      kind: "block",
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

  // M7.1: the listening files keep Heading3 as a plain question number and put the real round in
  // the group's own Heading2, which the parser used not to look at — every question then fell back
  // to the 연습N group counter and no mp3 could ever match it.
  it("takes the real round from the group heading when the question label does not name one", () => {
    const xml = doc(heading("Heading1", "문항 1~3") + heading("Heading2", "35회") + question("1", 2) + heading("Heading2", "36회") + question("1", 3));
    const draft = buildImportDraft("TOPIK_Listening_Cau01_03_OfficialTest_VERSION1.docx", xml);
    expect(draft.questions.map((q) => q.exam)).toEqual(["OfficialTest-35회", "OfficialTest-36회"]);
  });

  it("reads the round out of a heading that also carries the 연습N text", () => {
    // 36회, not 35회: that one is in the synonym table (M7.23) and would be filed under the whole
    // paper's label, which is a different rule and has its own tests.
    const xml = doc(heading("Heading1", "문항 1~2") + heading("Heading2", "연습1 (36회)") + question("1", 1));
    expect(buildImportDraft("TOPIK_Reading_Cau01_02_8DeOfficial_VERSION1.docx", xml).questions[0]!.exam).toBe("8DeOfficial-36회");
  });

  // One Heading2 group can hold items from several real rounds (Cau09/Cau10), so the item's own
  // label has to stay in charge where it names one.
  it("lets the question's own round override the group's", () => {
    const xml = doc(heading("Heading1", "문항 1") + heading("Heading2", "연습1 (35회)") + question("1-1 (41회)", 1));
    expect(buildImportDraft("TOPIK_Reading_Cau01_8DeOfficial_VERSION1.docx", xml).questions[0]!.exam).toBe("8DeOfficial-41회");
  });

  it("still falls back to 연습N when no heading names a round at all", () => {
    const xml = doc(heading("Heading1", "문항 1") + heading("Heading2", "연습1") + question("1-1", 1));
    expect(buildImportDraft("TOPIK_Reading_Cau01_Yonsei_VERSION1.docx", xml).questions[0]!.exam).toBe("Yonsei-연습1");
  });

  // M7.1: a listening question whose underline disagrees with the label is imported, with the
  // disagreement carried on the row so the review screen surfaces it first.
  it("carries an underline disagreement through as a warning, not an error", () => {
    const xml = doc(heading("Heading1", "문항 4~8") + heading("Heading2", "35회") + heading("Heading3", "4") + answer(2) + table("지문", ["가", "나", "다", "라"], 4));
    const draft = buildImportDraft("TOPIK_Listening_Cau04_08_OfficialTest_VERSION1.docx", xml);
    expect(draft.errors).toEqual([]);
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0]!.correct_option).toBe(2);
    expect(draft.questions[0]!.warning).toContain("option 4 is underlined");
    expect(draft.warnings.join(" ")).toContain("OfficialTest-35회 #4");
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

  // The block still comes from the question number: one real file covers questions 1-4 at once, so
  // its file name says "1~4" while the two pairs are two different tasks and two different blocks.
  it("splits a legacy merged block ('1~4', one file covering both pairs) into '1~2'/'3~4' by question number", () => {
    const xml = doc(
      heading("Heading1", "유형1: 문항 1~4") +
        heading("Heading2", "연습1") +
        plain("[1~2] (   )에 들어갈 가장 알맞은 것을 고르십시오.") +
        question("1-1", 1) +
        question("1-2", 2) +
        // Inside question 3's own body, which is where it has to go: a paragraph between two
        // questions belongs to the one before it, and the line would then apply from question 2.
        heading("Heading3", "1-3") +
        answer(3) +
        plain("[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오.") +
        table("stem 1-3", ["a", "b", "c", "d"], 3) +
        question("1-4", 4),
    );
    const draft = buildImportDraft("TOPIK_Reading_Cau01_04_8DeOfficial_VERSION1.docx", xml);
    expect(draft.errors).toEqual([]);
    expect(draft.questions.map((q) => [q.number, q.block, q.instruction])).toEqual([
      [1, "1~2", "[1~2] (   )에 들어갈 가장 알맞은 것을 고르십시오."],
      [2, "1~2", "[1~2] (   )에 들어갈 가장 알맞은 것을 고르십시오."],
      // M7.7: the instruction is the file's own, not a patch keyed on the number. The "[3~4] …"
      // line typed inside question 3 applies to it and the rest of the group (M7.3's rule), which
      // is exactly how the real files are now written.
      [3, "3~4", "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오."],
      [4, "3~4", "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오."],
    ]);
  });

  // M7.7: the patch that used to force this text is gone, so a file that says nothing gets nothing
  // — silence in the file is now visible in the app instead of being papered over.
  it("leaves 3-4 without an instruction when the file carries none", () => {
    const xml = doc(heading("Heading1", "유형1: 문항 3~4") + heading("Heading2", "연습1") + question("1-3", 1) + question("1-4", 2));
    const draft = buildImportDraft("TOPIK_Reading_Cau03_04_Yonsei_VERSION1.docx", xml);
    expect(draft.questions.map((q) => [q.number, q.block, q.instruction])).toEqual([
      [3, "3~4", null],
      [4, "3~4", null],
    ]);
  });

  it("does not touch the block/instruction of a question outside 1-4 (e.g. 문항 9)", () => {
    const xml = doc(heading("Heading1", "문항 9") + heading("Heading2", "연습1") + question("1-9", 2));
    const draft = buildImportDraft("TOPIK_Reading_Cau09_8DeOfficial_VERSION1.docx", xml);
    expect(draft.questions[0]).toMatchObject({ block: "9", instruction: null });
  });

  it("rejects a file name that does not follow the naming convention", () => {
    const draft = buildImportDraft("random.docx", doc(""));
    expect(draft.errors).toHaveLength(1);
    expect(draft.errors[0]).toContain("file name matches neither");
    expect(draft.questions).toEqual([]);
  });
});

// M7.3: the parser must never throw typed-up content away in silence. Where the stray paragraph
// sits decides whether the question is refused or the line is only reported.
describe("buildImportDraft and paragraphs nothing used", () => {
  const draftWith = (extra: string, afterTable = "") =>
    buildImportDraft(
      "TOPIK_Listening_Cau21_22_OfficialTest_VERSION1.docx",
      doc(
        heading("Heading1", "문항 21~22") +
          heading("Heading2", "연습1 (35회)") +
          plain("[21~22] 다음을 듣고 물음에 답하십시오. (각 2점)") +
          heading("Heading3", "1-21") +
          answer(2) +
          extra +
          table("남자: 안녕하세요.", ["a", "b", "c", "d"], 2) +
          afterTable,
      ),
    );

  it("refuses the question and quotes the line, naming the question", () => {
    const draft = draftWith(plain("남자의 중심 생각으로 맞는 것을 고르십시오."));
    expect(draft.questions).toEqual([]);
    expect(draft.errors).toHaveLength(1);
    expect(draft.errors[0]).toContain("#21");
    expect(draft.errors[0]).toContain('"남자의 중심 생각으로 맞는 것을 고르십시오."');
    expect(draft.errors[0]).toContain("HỎI: ");
  });

  // The file author's own glossary under a question (20 of them across the real reading files):
  // never part of the question, but still said out loud rather than dropped in silence.
  it("imports the question and reports a note written after the options", () => {
    const draft = draftWith("", plain("관람료: phí, tiền vé"));
    expect(draft.errors).toEqual([]);
    expect(draft.questions).toHaveLength(1);
    expect(draft.warnings).toEqual([expect.stringContaining('note after the options, not imported: "관람료: phí, tiền vé"')]);
  });

  it("imports a marked question line as part of the instruction", () => {
    const draft = draftWith(plain("HỎI: 남자의 중심 생각으로 맞는 것을 고르십시오."));
    expect(draft.errors).toEqual([]);
    expect(draft.questions[0]!.instruction).toBe("[21~22] 다음을 듣고 물음에 답하십시오. (각 2점)\n남자의 중심 생각으로 맞는 것을 고르십시오.");
    // The points still come from the block's own line.
    expect(draft.questions[0]!.points).toBe(2);
  });
});

// --- whole-paper files (M7.16) ------------------------------------------------------------------
//
// A complete exam arrives as one file of fifty questions in twenty blocks. No range can go in its
// name, and none needs to: every question prints its own "[N~M] …" line, which is the paper's real
// grouping rather than the stand-in the file name always was.

describe("parseTopikFileName, whole-paper shape", () => {
  it("reads the section and the source, and keeps the test number for cross-checking", () => {
    expect(parseTopikFileName("TOPIK_II_Test35_Listening_OfficialTest.docx")).toEqual({
      kind: "paper",
      section: "listening",
      source: "OfficialTest",
      test: 35,
    });
  });

  it("takes a reading paper the same way", () => {
    expect(parseTopikFileName("TOPIK_II_Test64_Reading_OfficialTest.docx")).toMatchObject({ kind: "paper", section: "reading", test: 64 });
  });

  it("still rejects a name that is neither shape", () => {
    expect(parseTopikFileName("TOPIK_II_Test35_Writing_OfficialTest.docx")).toBeNull();
    expect(parseTopikFileName("Test35_Listening.docx")).toBeNull();
  });
});

describe("blockRangeOf", () => {
  it("reads a range and a single number", () => {
    expect(blockRangeOf("[13~16] 다음을 듣고 물음에 답하십시오.")).toEqual({ start: 13, end: 16 });
    expect(blockRangeOf("[9] 다음을 듣고 …")).toEqual({ start: 9, end: 9 });
  });

  it("accepts the wide tilde and the spacing real files use", () => {
    expect(blockRangeOf("[21 ～ 22] …")).toEqual({ start: 21, end: 22 });
    expect(blockRangeOf("  [1~3] …")).toEqual({ start: 1, end: 3 });
  });

  it("is null when there is no bracket to read, rather than guessing", () => {
    expect(blockRangeOf("다음을 듣고 물음에 답하십시오.")).toBeNull();
    expect(blockRangeOf(null)).toBeNull();
    // Not at the start: that is a mention, not the block line.
    expect(blockRangeOf("다음 [1~3] 을 보고")).toBeNull();
  });
});

describe("buildImportDraft, whole paper", () => {
  const paper = (round: string) =>
    doc(
      heading("Heading2", round) +
        plain("[1~3] 다음을 듣고 알맞은 그림을 고르십시오. (각 2점)") +
        question("1", 1) +
        question("2", 2) +
        question("3", 3) +
        plain("[4~8] 다음 대화를 잘 듣고 이어질 수 있는 말을 고르십시오. (각 2점)") +
        question("4", 4),
    );

  it("numbers by the paper and blocks by each question's own line", () => {
    const draft = buildImportDraft("TOPIK_II_Test35_Listening_OfficialTest.docx", paper("35회"));
    expect(draft.errors).toEqual([]);
    expect(draft.questions.map((q) => [q.exam, q.number, q.block])).toEqual([
      ["OfficialTest-35회", 1, "1~3"],
      ["OfficialTest-35회", 2, "1~3"],
      ["OfficialTest-35회", 3, "1~3"],
      ["OfficialTest-35회", 4, "4~8"],
    ]);
  });

  it("pairs a block line that sits between two questions with the questions it names, not the one it follows", () => {
    // How every real whole-paper file is laid out: the "[4~8]" line comes after question 3's
    // table, so the parser hands it to question 3. Question 3 is not in 4~8, and keeps 1~3.
    const draft = buildImportDraft("TOPIK_II_Test35_Listening_OfficialTest.docx", paper("35회"));
    const third = draft.questions.find((q) => q.number === 3)!;
    const fourth = draft.questions.find((q) => q.number === 4)!;
    expect(third.block).toBe("1~3");
    expect(third.instruction).toContain("알맞은 그림을");
    expect(third.instruction).not.toContain("[4~8]");
    expect(fourth.block).toBe("4~8");
    expect(fourth.instruction).toContain("[4~8]");
  });

  it("gives the exam the label the document's round says, which the bank already uses", () => {
    const draft = buildImportDraft("TOPIK_II_Test35_Listening_OfficialTest.docx", paper("35회"));
    expect(new Set(draft.questions.map((q) => q.exam))).toEqual(new Set(["OfficialTest-35회"]));
  });

  it("warns when the name and the document disagree about the round, and believes the document", () => {
    const draft = buildImportDraft("TOPIK_II_Test36_Listening_OfficialTest.docx", paper("35회"));
    expect(draft.warnings.some((w) => w.includes("Test36") && w.includes("35회"))).toBe(true);
    expect(draft.questions[0]!.exam).toBe("OfficialTest-35회");
  });

  it("refuses a question with no block line rather than filing it under a made-up group", () => {
    const xml = doc(heading("Heading2", "35회") + question("1", 1));
    const draft = buildImportDraft("TOPIK_II_Test35_Listening_OfficialTest.docx", xml);
    expect(draft.questions).toEqual([]);
    expect(draft.errors[0]).toContain('no "[N~M] …" block line');
  });

  it("does not apply the reading 1-4 patch, which only exists for block files", () => {
    const xml = doc(
      heading("Heading2", "64회") +
        plain("[1~4] 다음을 읽고 ( )에 들어갈 가장 알맞은 것을 고르십시오.") +
        question("1", 1) +
        question("3", 3),
    );
    const draft = buildImportDraft("TOPIK_II_Test64_Reading_OfficialTest.docx", xml);
    // The paper says 1~4 for both, and the paper is right: the patch exists only because one
    // *block file* covers two tasks at once.
    expect(draft.questions.map((q) => [q.number, q.block])).toEqual([
      [1, "1~4"],
      [3, "1~4"],
    ]);
  });
});

describe("a transcript wrapped by Word (M7.16)", () => {
  const wrapped = "여자 : 이거 좀 봐 주실래요?\n남자 : 어디 좀 볼까요? 언제까지 해\n드리면 돼요?\n여자 : 내일까지 해 주세요.";

  it("spots the lines that do not start a turn", () => {
    expect(wrappedTranscriptLines(wrapped)).toEqual(["드리면 돼요?"]);
  });

  it("says nothing about a transcript with one line per turn", () => {
    expect(wrappedTranscriptLines("여자 : 네.\n남자 : 알겠습니다.")).toEqual([]);
  });

  it("judges nothing when there is no speaker label to judge against", () => {
    expect(wrappedTranscriptLines("안내 말씀 드리겠습니다.\n잠시 후 영화 촬영이")).toEqual([]);
    expect(wrappedTranscriptLines(null)).toEqual([]);
  });

  it("treats a mistyped speaker label as a turn, so it is not reported as a wrapped line", () => {
    // A real file has "남잠:" for "남자:". A fixed list of labels called that line a wrap, and the
    // repair built on top of it merged two people's turns into one.
    expect(wrappedTranscriptLines("여자: 못 갔어.\n남잠: 텐트같이 필요한 물건들이 있다던데?")).toEqual([]);
  });

  it("counts every line of a turn broken several times", () => {
    expect(wrappedTranscriptLines("남자 : 하나\n둘\n셋\n여자 : 넷")).toEqual(["둘", "셋"]);
  });

  it("leaves the text exactly as the file has it — the breaks are reported, not repaired", () => {
    // Korean wraps at any character, so a break sits at a space as readily as inside a word, and
    // the file keeps no trace of which. The draft therefore carries the text unchanged.
    const xml = doc(
      heading("Heading2", "35회") +
        plain("[1~3] 다음을 듣고 알맞은 그림을 고르십시오.") +
        heading("Heading3", "1") +
        plain("1(1)") +
        `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>여자 : 가고 싶었는데</w:t><w:br/><w:t>못 갔어.</w:t></w:r></w:p></w:tc></w:tr>` +
          `<w:tr>${cell("a", true)}${cell("b")}</w:tr><w:tr>${cell("c")}${cell("d")}</w:tr></w:tbl>`,
    );
    const draft = buildImportDraft("TOPIK_II_Test35_Listening_OfficialTest.docx", xml);
    expect(draft.questions[0]!.stem.text).toBe("여자 : 가고 싶었는데\n못 갔어.");
    expect(draft.questions[0]!.warning).toContain("line break(s) typed inside a turn");
  });
});

describe("an option typed with its own number (M7.16)", () => {
  it("strips the number when it matches the option's position", () => {
    expect(stripOptionNumber("1. 그래? 텐트만 사면 되겠네.", 1)).toBe("그래? 텐트만 사면 되겠네.");
    expect(stripOptionNumber("3) 미리 알았으면 좋았을걸.", 3)).toBe("미리 알았으면 좋았을걸.");
  });

  it("leaves a number that disagrees with the position exactly as typed", () => {
    expect(stripOptionNumber("3. 미리 알았으면 좋았을걸.", 1)).toBe("3. 미리 알았으면 좋았을걸.");
  });

  it("leaves text that merely starts with a digit alone", () => {
    expect(stripOptionNumber("1시간 후에 만나요.", 1)).toBe("1시간 후에 만나요.");
    expect(hasOptionNumber("1시간 후에 만나요.")).toBe(false);
    expect(hasOptionNumber("1. 그래?")).toBe(true);
  });
});

describe("a shared source becomes a group (M7.21)", () => {
  const draft = (over: { section?: string; exam?: string; number: number; same_segment: boolean; stem?: string | null }) =>
    ({
      section: (over.section ?? "reading") as "reading" | "listening",
      exam: over.exam ?? "8DeOfficial-35회",
      number: over.number,
      block: "19~20",
      instruction: null,
      points: 2,
      same_segment: over.same_segment,
      group_key: null,
      stem: { text: over.stem === undefined ? "passage" : over.stem, image_rid: null },
      options: [],
      correct_option: 1,
      warning: null,
    }) as Parameters<typeof assignGroupKeys>[0][number];

  it("gives both questions of a pair the first one's key", () => {
    const questions = [draft({ number: 19, same_segment: false }), draft({ number: 20, same_segment: true })];
    assignGroupKeys(questions);
    expect(questions.map((q) => q.group_key)).toEqual(["reading|8DeOfficial-35회|19", "reading|8DeOfficial-35회|19"]);
  });

  // Null, not a key of its own: `topikGroupId` already treats a question with no group as a group
  // of one, and null is what lets a backfill tell "the file said nothing" from "the file said this".
  it("leaves a question that shares nothing at null", () => {
    const questions = [draft({ number: 5, same_segment: false }), draft({ number: 6, same_segment: false })];
    assignGroupKeys(questions);
    expect(questions.map((q) => q.group_key)).toEqual([null, null]);
  });

  it("handles a run of three", () => {
    const questions = [
      draft({ number: 48, same_segment: false }),
      draft({ number: 49, same_segment: true }),
      draft({ number: 50, same_segment: true }),
    ];
    assignGroupKeys(questions);
    expect(new Set(questions.map((q) => q.group_key)).size).toBe(1);
    expect(questions[2]!.group_key).toBe("reading|8DeOfficial-35회|48");
  });

  // 35회 reading, for real: #46 was refused (a paragraph nothing used), so #45 and #47 ended up
  // next to each other in this list and #47's mark chained it onto #44's group — the passage about
  // emissions trading and the one about a merger, in one group.
  it("never chains across a question that is missing from the list", () => {
    const questions = [
      draft({ number: 44, same_segment: false }),
      draft({ number: 45, same_segment: true }),
      draft({ number: 47, same_segment: true, stem: "another passage" }),
    ];
    assignGroupKeys(questions);
    expect(questions.map((q) => q.group_key)).toEqual(["reading|8DeOfficial-35회|44", "reading|8DeOfficial-35회|44", null]);
    // And with nothing to chain onto, #47 is a group of one rather than a wrong group of two.
    expect(driftNotes(questions)).toEqual([]);
  });

  it("never lets a chain run across two exams", () => {
    // A CHUNG ĐOẠN mark on the first question of an exam has nothing to attach to; it must not
    // reach back into the previous exam's last question.
    const questions = [draft({ number: 20, same_segment: false }), draft({ exam: "8DeOfficial-36회", number: 19, same_segment: true })];
    assignGroupKeys(questions);
    expect(questions.map((q) => q.group_key)).toEqual([null, null]);
  });

  it("keeps the same key when the same file is imported again", () => {
    const once = [draft({ number: 19, same_segment: false }), draft({ number: 20, same_segment: true })];
    const twice = [draft({ number: 19, same_segment: false }), draft({ number: 20, same_segment: true })];
    assignGroupKeys(once);
    assignGroupKeys(twice);
    expect(once.map((q) => q.group_key)).toEqual(twice.map((q) => q.group_key));
  });

  // M7.23: 46 carries the sentence to be placed, 47 does not — one passage, so no drift.
  it("does not call a boxed sentence a drift: only the passage is shared", () => {
    const passage = "만년 2위를 면하지 못하던 포털 사이트… ( ㉠ ) … ( ㉣ )";
    const questions = [
      draft({ number: 46, same_segment: false, stem: `${passage}
<보 기>
이는 합병 기업이 각자의 강점을 합친 것…` }),
      draft({ number: 47, same_segment: true, stem: passage }),
    ];
    assignGroupKeys(questions);
    expect(driftNotes(questions)).toEqual([]);
  });

  it("reports a group whose two stems are not the same text, printing both", () => {
    const questions = [draft({ number: 19, same_segment: false }), draft({ number: 20, same_segment: true, stem: "other passage" })];
    assignGroupKeys(questions);
    const notes = driftNotes(questions);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("#19 and #20 share a passage but their stem text differs");
    expect(notes[0]).toContain('"passage"');
    expect(notes[0]).toContain('"other passage"');
  });

  it("says nothing when the second question inherited the first one's passage", () => {
    const questions = [draft({ number: 19, same_segment: false }), draft({ number: 20, same_segment: true })];
    assignGroupKeys(questions);
    expect(driftNotes(questions)).toEqual([]);
  });
});

describe("the reading pair in a real file (M7.21)", () => {
  // The shape of TOPIK_Reading_Cau19_20_8DeOfficial_VERSION1.docx: the block line uses the
  // **full-width** tilde a Korean IME produces, which is why the parser must accept it — spelled
  // `~` only, the line was not recognised, and question 19 was refused as an unaccounted-for
  // paragraph while 20 imported happily.
  const xml = doc(
    heading("Heading2", "35회") +
      heading("Heading3", "19") +
      plain("[19\uff5e20] 다음을 읽고 물음에 답하십시오. (각 2점)") +
      answer(2) +
      plain("HỎI:( )에 들어갈 알맞은 것을 고르십시오.") +
      table("과일을 빨리 익히기 위해", ["또는", "또한", "그래도", "그러면"], 2) +
      heading("Heading3", "20") +
      answer(4) +
      plain("CHUNG ĐOẠN") +
      plain("HỎI:이 글의 내용과 같은 것을 고르십시오.") +
      `<w:tbl><w:tr>${cell("")}</w:tr><w:tr>${cell("a")}${cell("b")}</w:tr><w:tr>${cell("c")}${cell("d", true)}</w:tr></w:tbl>`,
  );

  it("imports both questions, as one group, sharing one passage", () => {
    const draft = buildImportDraft("TOPIK_Reading_Cau19_20_8DeOfficial_VERSION1.docx", xml);
    expect(draft.errors).toEqual([]);
    expect(draft.questions.map((q) => q.number)).toEqual([19, 20]);
    // Filed under the whole paper's label by the synonym table (M7.23).
    expect(draft.questions[0]!.group_key).toBe("reading|OfficialTest-35회|19");
    expect(draft.questions[1]!.group_key).toBe(draft.questions[0]!.group_key);
    expect(draft.questions[1]!.stem.text).toBe(draft.questions[0]!.stem.text);
    expect(draft.questions[0]!.correct_option).toBe(2);
    expect(draft.questions[1]!.correct_option).toBe(4);
  });

  it("reads each question's own HỎI line under the shared block line", () => {
    const draft = buildImportDraft("TOPIK_Reading_Cau19_20_8DeOfficial_VERSION1.docx", xml);
    expect(draft.questions[0]!.instruction).toContain("( )에 들어갈 알맞은 것을 고르십시오.");
    expect(draft.questions[1]!.instruction).toContain("이 글의 내용과 같은 것을 고르십시오.");
    expect(draft.questions[0]!.instruction).toContain("(각 2점)");
  });
});

// M7.23: two sources, one real paper. Not another FIXED_NUMBER_INSTRUCTION — see the table's own
// comment for why a synonym list is allowed where an override table was not.
describe("two source names for one real exam", () => {
  it("files a block file's 35회 group under the whole paper's label", () => {
    const xml = doc(heading("Heading2", "35회") + question("1-1", 2) + question("1-2", 3));
    const draft = buildImportDraft("TOPIK_Reading_Cau01_02_8DeOfficial_VERSION1.docx", xml);
    expect(draft.questions.map((q) => q.exam)).toEqual(["OfficialTest-35회", "OfficialTest-35회"]);
  });

  it("says so in the report rather than renaming in silence, once per label", () => {
    const xml = doc(heading("Heading2", "35회") + question("1-1", 2) + question("1-2", 3));
    const draft = buildImportDraft("TOPIK_Reading_Cau01_02_8DeOfficial_VERSION1.docx", xml);
    const said = draft.warnings.filter((w) => w.includes("the same real paper under two source names"));
    expect(said).toEqual(['exam "8DeOfficial-35회" is filed as "OfficialTest-35회" (the same real paper under two source names)']);
  });

  it("leaves every other round of the same source alone", () => {
    const xml = doc(heading("Heading2", "36회") + question("1-1", 2) + question("1-2", 3));
    const draft = buildImportDraft("TOPIK_Reading_Cau01_02_8DeOfficial_VERSION1.docx", xml);
    expect(draft.questions.map((q) => q.exam)).toEqual(["8DeOfficial-36회", "8DeOfficial-36회"]);
    expect(draft.warnings.filter((w) => w.includes("two source names"))).toEqual([]);
  });

  it("gives the group key the canonical label too, so a re-import matches", () => {
    // The mark goes inside the question it belongs to: a paragraph between two questions belongs
    // to the one before it (M7.3).
    const second = heading("Heading3", "1-2") + answer(3) + plain("CHUNG ĐOẠN") + table("", ["a", "b", "c", "d"], 3);
    const xml = doc(heading("Heading2", "35회") + question("1-1", 2) + second);
    const draft = buildImportDraft("TOPIK_Reading_Cau01_02_8DeOfficial_VERSION1.docx", xml);
    expect(draft.questions[1]!.group_key).toBe("reading|OfficialTest-35회|1");
  });
});
