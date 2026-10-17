import { describe, expect, it } from "vitest";
import { TOPIK_IMAGE_MAX_BYTES } from "../../shared/topik";
import type { DraftQuestion } from "../../worker/services/topikImport";
import { FAKE_WEBP } from "../../worker/test/fakeUpload";
import { checkImageBytes, checkQuestionImages, imageRefsOf, verifiedAfterOverwrite, type MediaByRid } from "./plan";

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
  instruction: null,
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
