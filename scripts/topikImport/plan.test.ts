import { describe, expect, it } from "vitest";
import { TOPIK_IMAGE_MAX_BYTES } from "../../shared/topik";
import type { DraftQuestion } from "../../worker/services/topikImport";
import { FAKE_WEBP } from "../../worker/test/fakeUpload";
import {
  changedLines,
  checkImageBytes,
  checkQuestionImages,
  diffColumns,
  duplicateKeys,
  refreshAiSql,
  staleAiRows,
  type DiffRow,
  type QuestionSnapshot,
  examCoverage,
  shortGroups,
  fileMatchesFilter,
  filterLabel,
  forceScopeProblem,
  imageRefsOf,
  parseSectionFlag,
  verifiedAfterOverwrite,
  type ImportFilter,
  type MediaByRid,
} from "./plan";

/** `FAKE_WEBP` with its width set to 2000px — over `TOPIK_IMAGE_MAX_SIDE`, whatever it is today.
 * Deliberately not just past it: that constant has moved three times as real scans arrived, and a
 * fixture sized to clear it by one pixel would need editing every time. 2000px stands for the case
 * the limit is actually for — a phone photo pasted in by mistake (SPEC §11, `TOPIK_IMAGE_MAX_SIDE`). */
function oversizedForTopik(): Uint8Array {
  const b = Uint8Array.from(FAKE_WEBP);
  b.set([0xcf, 0x07, 0x00], 24); // VP8X width-1, 24-bit LE: 1999 → width 2000
  return b;
}

/** `FAKE_WEBP` padded past TOPIK's byte-size limit (dimensions stay valid). */
function overweightForTopik(): Uint8Array {
  const padded = new Uint8Array(TOPIK_IMAGE_MAX_BYTES + 1);
  padded.set(FAKE_WEBP);
  return padded;
}

const question = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  section: "reading",
  exam: "Test-연습1",
  number: 1,
  block: "1",
  points: 2,
  instruction: null,
  same_segment: false,
  group_key: null,
  stem: { text: "stem", image_rid: null },
  options: [
    { text: "a", image_rid: null },
    { text: "b", image_rid: null },
    { text: "c", image_rid: null },
    { text: "d", image_rid: null },
  ],
  correct_option: 1,
  warning: null,
  ...over,
});

describe("checkImageBytes", () => {
  it("accepts a valid WebP within the TOPIK size/dimension limits", () => {
    expect(checkImageBytes(FAKE_WEBP, "image/webp")).toEqual({ ok: true });
  });

  it("rejects an image over TOPIK's own pixel-size limit (looser than the 512px word/profile limit)", () => {
    expect(checkImageBytes(oversizedForTopik(), "image/webp").ok).toBe(false);
  });

  it("rejects a file over TOPIK's own byte-size limit", () => {
    expect(checkImageBytes(overweightForTopik(), "image/webp").ok).toBe(false);
  });

  it("rejects an unsupported content type", () => {
    const result = checkImageBytes(FAKE_WEBP, "image/gif");
    expect(result).toEqual({ ok: false, reason: 'unsupported content type "image/gif"' });
  });

  it("rejects an empty file", () => {
    expect(checkImageBytes(new Uint8Array(0), "image/webp")).toEqual({ ok: false, reason: "empty file" });
  });
});

describe("imageRefsOf", () => {
  it("collects the stem and every option's image reference, in order", () => {
    const q = question({
      stem: { text: null, image_rid: "rId1" },
      options: [
        { text: "", image_rid: "rId2" },
        { text: "b", image_rid: null },
        { text: "", image_rid: "rId3" },
        { text: "d", image_rid: null },
      ],
    });
    expect(imageRefsOf(q)).toEqual(["rId1", "rId2", "rId3"]);
  });

  it("returns an empty list for a text-only question", () => {
    expect(imageRefsOf(question())).toEqual([]);
  });
});

describe("checkQuestionImages", () => {
  it("passes a question whose image reference resolves to valid bytes (M6.1 fix: the word/ prefix bug used to make every lookup fail)", () => {
    const mediaByRid: MediaByRid = new Map([["rId9", { bytes: FAKE_WEBP, contentType: "image/webp" }]]);
    const q = question({ stem: { text: null, image_rid: "rId9" } });
    expect(checkQuestionImages(q, mediaByRid)).toEqual([]);
  });

  it("errors — does not silently skip — when a referenced image has no matching media", () => {
    const q = question({ stem: { text: null, image_rid: "rId9" } });
    expect(checkQuestionImages(q, new Map())).toEqual(["image rId9 is referenced but was not found in word/media"]);
  });

  it("errors when the media exists but fails validation (too big, wrong type, ...)", () => {
    const mediaByRid: MediaByRid = new Map([["rId9", { bytes: oversizedForTopik(), contentType: "image/webp" }]]);
    const q = question({ stem: { text: null, image_rid: "rId9" } });
    const errors = checkQuestionImages(q, mediaByRid);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("rId9");
  });

  it("checks every option's image too, not just the stem", () => {
    const mediaByRid: MediaByRid = new Map([["rId1", { bytes: FAKE_WEBP, contentType: "image/webp" }]]);
    const q = question({ options: [{ text: "", image_rid: "rId1" }, { text: "", image_rid: "rId-missing" }, { text: "c", image_rid: null }, { text: "d", image_rid: null }] });
    expect(checkQuestionImages(q, mediaByRid)).toEqual(["image rId-missing is referenced but was not found in word/media"]);
  });
});

describe("verifiedAfterOverwrite", () => {
  it("resets to false by default (content changed, an adult should look again)", () => {
    expect(verifiedAfterOverwrite(true, false)).toBe(false);
    expect(verifiedAfterOverwrite(false, false)).toBe(false);
  });

  it("--keep-verified keeps whatever the row already had", () => {
    expect(verifiedAfterOverwrite(true, true)).toBe(true);
    expect(verifiedAfterOverwrite(false, true)).toBe(false);
  });
});

describe("parseSectionFlag", () => {
  it("no flag means no section filter", () => {
    expect(parseSectionFlag(undefined)).toEqual({ ok: true, section: null });
  });

  it("accepts either section, case-insensitively", () => {
    expect(parseSectionFlag("listening")).toEqual({ ok: true, section: "listening" });
    expect(parseSectionFlag(" Reading ")).toEqual({ ok: true, section: "reading" });
  });

  it("rejects an unknown value instead of silently importing everything", () => {
    const r = parseSectionFlag("listen");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("reading|listening");
  });

  it("rejects an empty value (--section with nothing after it)", () => {
    expect(parseSectionFlag("").ok).toBe(false);
  });
});

describe("fileMatchesFilter", () => {
  const reading = "TOPIK_Reading_Cau01_02_Yonsei_VERSION1.docx";
  const listening = "TOPIK_Listening_Cau04_08_OfficialTest_VERSION1.docx";

  it("no filter keeps every file", () => {
    const none: ImportFilter = { section: null, source: null , name: null };
    expect(fileMatchesFilter(reading, none)).toBe(true);
    expect(fileMatchesFilter(listening, none)).toBe(true);
  });

  it("--section keeps only that section", () => {
    const filter: ImportFilter = { section: "listening", source: null , name: null };
    expect(fileMatchesFilter(listening, filter)).toBe(true);
    expect(fileMatchesFilter(reading, filter)).toBe(false);
  });

  it("--source matches the file name's source, case-insensitively", () => {
    expect(fileMatchesFilter(reading, { section: null, source: "yonsei" , name: null })).toBe(true);
    expect(fileMatchesFilter(listening, { section: null, source: "yonsei" , name: null })).toBe(false);
  });

  it("both filters must match", () => {
    expect(fileMatchesFilter(listening, { section: "listening", source: "OfficialTest" , name: null })).toBe(true);
    expect(fileMatchesFilter(listening, { section: "reading", source: "OfficialTest" , name: null })).toBe(false);
  });

  it("keeps a file name it cannot parse, so buildImportDraft still reports it", () => {
    expect(fileMatchesFilter("notes.docx", { section: "listening", source: null , name: null })).toBe(true);
  });
});

describe("forceScopeProblem", () => {
  const existingBySection = { reading: 229, listening: 24 };

  it("refuses --force with no --section, naming the count per section", () => {
    const msg = forceScopeProblem({ force: true, section: null, allSections: false, existingBySection });
    expect(msg).toContain("253 existing question(s)");
    expect(msg).toContain("reading 229");
    expect(msg).toContain("listening 24");
    expect(msg).toContain("--all-sections");
  });

  it("allows --force once a section is named", () => {
    expect(forceScopeProblem({ force: true, section: "listening", allSections: false, existingBySection })).toBeNull();
  });

  it("allows --force with an explicit --all-sections", () => {
    expect(forceScopeProblem({ force: true, section: null, allSections: true, existingBySection })).toBeNull();
  });

  it("does not block a run without --force (nothing gets overwritten)", () => {
    expect(forceScopeProblem({ force: false, section: null, allSections: false, existingBySection })).toBeNull();
  });

  it("does not block when nothing existing would be overwritten", () => {
    expect(forceScopeProblem({ force: true, section: null, allSections: false, existingBySection: {} })).toBeNull();
    expect(forceScopeProblem({ force: true, section: null, allSections: false, existingBySection: { reading: 0 } })).toBeNull();
  });

  it("leaves out a section that has nothing to overwrite", () => {
    const msg = forceScopeProblem({ force: true, section: null, allSections: false, existingBySection: { listening: 24 } });
    expect(msg).toContain("question(s): listening 24.");
  });
});

describe("filterLabel", () => {
  it("says ALL when no section is given", () => {
    expect(filterLabel({ section: null, source: null, name: null })).toBe("section=ALL");
  });

  it("names both axes when both are set", () => {
    expect(filterLabel({ section: "listening", source: "OfficialTest", name: null })).toBe("section=listening, source=OfficialTest");
  });

  it("names the file filter too", () => {
    expect(filterLabel({ section: null, source: null, name: "Test35" })).toBe("section=ALL, file~Test35");
  });
});

describe("fileMatchesFilter with --file", () => {
  const f = (name: string | null) => ({ section: null, source: null, name });

  it("keeps only the files whose name contains the text, ignoring case", () => {
    expect(fileMatchesFilter("TOPIK_II_Test35_Listening_OfficialTest.docx", f("test35"))).toBe(true);
    expect(fileMatchesFilter("TOPIK_II_Test36_Listening_OfficialTest.docx", f("Test35"))).toBe(false);
  });

  it("applies to a file name this project cannot parse, which is when you most want it", () => {
    expect(fileMatchesFilter("whatever Test35.docx", f("Test35"))).toBe(true);
    expect(fileMatchesFilter("whatever.docx", f("Test35"))).toBe(false);
  });
});

// M7.8: the parser counts Heading3 labels and nothing else, so a group typed up only as far as
// question 17 of a 16-18 file parses cleanly and the hole goes unnoticed. The file name is the only
// place the intent is written down.
describe("shortGroups", () => {
  const q = (exam: string, number: number) => ({ exam, number });

  it("names the group, what it has, what the file name asks for, and which number is missing", () => {
    const questions = [q("A-60회", 16), q("A-60회", 17), q("A-64회", 16), q("A-64회", 17), q("A-64회", 18)];
    expect(shortGroups(questions, 16, 18)).toEqual([{ exam: "A-60회", have: 2, want: 3, missing: [18] }]);
  });

  it("says nothing when every group is complete", () => {
    expect(shortGroups([q("A", 1), q("A", 2), q("B", 1), q("B", 2)], 1, 2)).toEqual([]);
  });

  it("handles a single-number file, where a group is one question", () => {
    expect(shortGroups([q("A", 9)], 9, 9)).toEqual([]);
  });

  it("lists every missing number, not just the last", () => {
    expect(shortGroups([q("A", 2)], 1, 4)).toEqual([{ exam: "A", have: 1, want: 4, missing: [1, 3, 4] }]);
  });
});

describe("examCoverage", () => {
  const q = (exam: string, number: number) => ({ exam, number });

  it("reports how far the numbering runs unbroken from 1 — what a mock test can use", () => {
    // 12 questions, but a hole at 5 means a paper of this exam can only be sat as 4 questions.
    const questions = [1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 16].map((n) => q("A", n));
    expect(examCoverage(questions)).toEqual([{ exam: "A", count: 12, usable: 4 }]);
  });

  it("is zero when question 1 itself is missing", () => {
    expect(examCoverage([q("A", 2), q("A", 3)])).toEqual([{ exam: "A", count: 2, usable: 0 }]);
  });

  it("counts a complete paper in full", () => {
    expect(examCoverage([q("A", 1), q("A", 2), q("A", 3)])).toEqual([{ exam: "A", count: 3, usable: 3 }]);
  });

  it("keeps the exams apart and in a stable order", () => {
    expect(examCoverage([q("B", 1), q("A", 1), q("A", 2)]).map((e) => e.exam)).toEqual(["A", "B"]);
  });
});

// --- the comparison table (M7.15) ---------------------------------------------------------------

const snap = (over: Partial<QuestionSnapshot> = {}): QuestionSnapshot => ({
  block: "1~3",
  instruction: "다음을 듣고 알맞은 것을 고르십시오.",
  stem_text: "남자: 안녕하세요.\n여자: 네, 안녕하세요.",
  stem_image_key: null,
  options: '[{"text":"1","image_key":null}]',
  correct_option: 2,
  warning: null,
  group_key: null,
  ...over,
});

const row = (over: Partial<DiffRow> = {}): DiffRow => ({
  id: "q-1",
  exam: "OfficialTest-35회",
  number: 2,
  verified: true,
  has_vocab: false,
  has_explain: false,
  diffs: [],
  ...over,
});

describe("diffColumns", () => {
  it("finds nothing when the overwrite would write the same thing back", () => {
    expect(diffColumns(snap(), snap())).toEqual([]);
  });

  it("names each column that differs, with both sides", () => {
    const diffs = diffColumns(snap(), snap({ stem_text: "남자: 반갑습니다.\n여자: 네, 안녕하세요.", correct_option: 3 }));
    expect(diffs.map((d) => d.column)).toEqual(["stem_text", "correct_option"]);
    expect(diffs[1]).toEqual({ column: "correct_option", before: "2", after: "3" });
  });

  it("sees a null becoming a value, and the other way round", () => {
    expect(diffColumns(snap({ warning: null }), snap({ warning: "answer label says 2" }))).toEqual([
      { column: "warning", before: null, after: "answer label says 2" },
    ]);
    expect(diffColumns(snap({ stem_image_key: "images/upload/a.png" }), snap({ stem_image_key: null }))).toEqual([
      { column: "stem_image_key", before: "images/upload/a.png", after: null },
    ]);
  });

  it("does not compare anything the UPDATE does not write", () => {
    // `verified`, the AI columns and the timestamps are reported separately or left alone; the
    // table must not claim an overwrite "changes" something it never names.
    // `group_key` joined the list in M7.21, and the UPDATE names it too — this test is the thing
    // that would have caught adding one without the other.
    expect(Object.keys(snap())).toEqual([
      "block",
      "instruction",
      "stem_text",
      "stem_image_key",
      "options",
      "correct_option",
      "warning",
      "group_key",
    ]);
  });
});

describe("changedLines", () => {
  it("returns only the lines that moved", () => {
    expect(changedLines("a\nb\nc", "a\nB\nc")).toEqual([{ line: 2, before: "b", after: "B" }]);
  });

  it("is empty when the text is identical", () => {
    expect(changedLines("a\nb", "a\nb")).toEqual([]);
  });

  it("gives up rather than guessing when a line was added or removed", () => {
    expect(changedLines("a\nb", "a\nb\nc")).toBeNull();
    expect(changedLines(null, "a")).toBeNull();
    expect(changedLines("a", null)).toBeNull();
  });

  it("handles a one-line field", () => {
    expect(changedLines("고동안", "그동안")).toEqual([{ line: 1, before: "고동안", after: "그동안" }]);
  });
});

describe("staleAiRows", () => {
  const textChanged = [{ column: "stem_text" as const, before: "a", after: "b" }];

  it("picks a row whose source text changed and that has AI content", () => {
    const rows = [row({ diffs: textChanged, has_vocab: true }), row({ id: "q-2", diffs: textChanged, has_explain: true })];
    expect(staleAiRows(rows).map((r) => r.id)).toEqual(["q-1", "q-2"]);
  });

  it("leaves alone a row with no AI content yet — there is nothing stale to clear", () => {
    expect(staleAiRows([row({ diffs: textChanged })])).toEqual([]);
  });

  it("leaves alone a row whose change cannot affect what the AI read", () => {
    // `block` and `warning` are not part of the vocabulary or the explanation's input.
    const rows = [row({ has_vocab: true, diffs: [{ column: "block", before: "1~3", after: "1~4" }] })];
    expect(staleAiRows(rows)).toEqual([]);
  });

  it("counts a changed answer, which the explanation is built from", () => {
    const rows = [row({ has_explain: true, diffs: [{ column: "correct_option", before: "2", after: "4" }] })];
    expect(staleAiRows(rows)).toHaveLength(1);
  });
});

describe("refreshAiSql", () => {
  it("is null when nothing is stale, so the run says so instead of printing an empty statement", () => {
    expect(refreshAiSql([row()])).toBeNull();
  });

  it("clears only the two timestamps, for exactly the stale ids", () => {
    const rows = [
      row({ id: "q-a", has_vocab: true, diffs: [{ column: "stem_text", before: "a", after: "b" }] }),
      row({ id: "q-b" }),
    ];
    const sql = refreshAiSql(rows)!;
    expect(sql).toContain("SET vocab_checked_at = NULL, explain_checked_at = NULL");
    expect(sql).toContain("'q-a'");
    expect(sql).not.toContain("'q-b'");
    // The generated text itself is never deleted: until the new one lands the screen still has
    // something to show.
    expect(sql).not.toContain("vocab =");
    expect(sql).not.toContain("explanation_vi");
  });
});

// M7.25: `CANONICAL_EXAM` makes two files resolve to the same exam on purpose, so a run that does
// not filter by file now contains both the block file and the whole paper for the same questions.
describe("duplicateKeys", () => {
  const d = (file: string, number: number, exam = "OfficialTest-36회") => ({ file, section: "reading", exam, number });

  it("names the question and both files", () => {
    expect(duplicateKeys([d("TOPIK_Reading_Cau01_02_8DeOfficial_VERSION1.docx", 1), d("TOPIK_II_Test36_Reading_OfficialTest.docx", 1)])).toEqual([
      { key: "reading OfficialTest-36회 #1", files: ["TOPIK_II_Test36_Reading_OfficialTest.docx", "TOPIK_Reading_Cau01_02_8DeOfficial_VERSION1.docx"] },
    ]);
  });

  it("says nothing when every question comes from one file", () => {
    expect(duplicateKeys([d("a.docx", 1), d("a.docx", 2), d("b.docx", 1, "OfficialTest-37회")])).toEqual([]);
  });

  it("keeps the sections apart: the same number in both is two questions", () => {
    const reading = { file: "a.docx", section: "reading", exam: "OfficialTest-36회", number: 1 };
    const listening = { ...reading, section: "listening", file: "b.docx" };
    expect(duplicateKeys([reading, listening])).toEqual([]);
  });

  // One file legitimately produces a question once; a repeat inside one file is a different bug,
  // and this reports it too rather than pretending a single file cannot do it.
  it("reports a file that produces the same question twice", () => {
    expect(duplicateKeys([d("a.docx", 1), d("a.docx", 1)])[0]).toMatchObject({ files: ["a.docx"] });
  });
});
