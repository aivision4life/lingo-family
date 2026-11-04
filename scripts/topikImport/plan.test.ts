import { describe, expect, it } from "vitest";
import { TOPIK_IMAGE_MAX_BYTES } from "../../shared/topik";
import type { DraftQuestion } from "../../worker/services/topikImport";
import { FAKE_WEBP } from "../../worker/test/fakeUpload";
import {
  checkImageBytes,
  checkQuestionImages,
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

/** `FAKE_WEBP` with its width set to 2000px — over TOPIK's own 1600px limit. */
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

  it("rejects an image over TOPIK's own pixel-size limit (1600px, looser than the 512px word/profile limit)", () => {
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
    const none: ImportFilter = { section: null, source: null };
    expect(fileMatchesFilter(reading, none)).toBe(true);
    expect(fileMatchesFilter(listening, none)).toBe(true);
  });

  it("--section keeps only that section", () => {
    const filter: ImportFilter = { section: "listening", source: null };
    expect(fileMatchesFilter(listening, filter)).toBe(true);
    expect(fileMatchesFilter(reading, filter)).toBe(false);
  });

  it("--source matches the file name's source, case-insensitively", () => {
    expect(fileMatchesFilter(reading, { section: null, source: "yonsei" })).toBe(true);
    expect(fileMatchesFilter(listening, { section: null, source: "yonsei" })).toBe(false);
  });

  it("both filters must match", () => {
    expect(fileMatchesFilter(listening, { section: "listening", source: "OfficialTest" })).toBe(true);
    expect(fileMatchesFilter(listening, { section: "reading", source: "OfficialTest" })).toBe(false);
  });

  it("keeps a file name it cannot parse, so buildImportDraft still reports it", () => {
    expect(fileMatchesFilter("notes.docx", { section: "listening", source: null })).toBe(true);
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
    expect(filterLabel({ section: null, source: null })).toBe("section=ALL");
  });

  it("names both axes when both are set", () => {
    expect(filterLabel({ section: "listening", source: "OfficialTest" })).toBe("section=listening, source=OfficialTest");
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
