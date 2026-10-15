// Pure parts of the TOPIK import (M6.1): no R2/D1/file access here, so these are easy to unit test.
import { IMAGE_UPLOAD_TYPES } from "../../shared/image";
import { TOPIK_IMAGE_MAX_BYTES, TOPIK_IMAGE_MAX_SIDE } from "../../shared/topik";
import { imageInfo } from "../../worker/lib/imageInfo";
import type { DraftQuestion } from "../../worker/services/topikImport";

export type MediaByRid = Map<string, { bytes: Uint8Array; contentType: string }>;

/**
 * Whether `bytes` would pass `storeUploadedImage()`'s validation (type/size/dimensions) — pure, no
 * R2 access, so the dry run can predict an image failure instead of only discovering it on
 * `--apply` (M6.1 fix: an unresolvable/invalid image used to silently become `image_key: null`).
 */
export function checkImageBytes(bytes: Uint8Array, contentType: string): { ok: true } | { ok: false; reason: string } {
  const type = contentType.split(";")[0]!.trim();
  if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(type)) return { ok: false, reason: `unsupported content type "${type}"` };
  if (bytes.length === 0) return { ok: false, reason: "empty file" };
  if (bytes.length > TOPIK_IMAGE_MAX_BYTES) return { ok: false, reason: `${bytes.length} bytes exceeds the ${TOPIK_IMAGE_MAX_BYTES}-byte limit` };
  const info = imageInfo(bytes);
  const expected = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[type];
  if (info.ext !== expected) return { ok: false, reason: `file content does not look like a ${type}` };
  if (info.width <= 0 || info.height <= 0) return { ok: false, reason: "could not read the image's pixel size" };
  if (info.width > TOPIK_IMAGE_MAX_SIDE || info.height > TOPIK_IMAGE_MAX_SIDE) {
    return { ok: false, reason: `${info.width}x${info.height}px exceeds the ${TOPIK_IMAGE_MAX_SIDE}px limit` };
  }
  return { ok: true };
}

/** Every image reference a question has (stem + its 4 options), stem first. */
export function imageRefsOf(q: DraftQuestion): string[] {
  return [q.stem.image_rid, ...q.options.map((o) => o.image_rid)].filter((r): r is string => r !== null);
}

/**
 * Checks every image reference a question has, without touching R2: a reference whose media
 * couldn't be found in the docx, or whose bytes would fail validation, is reported here instead of
 * silently becoming a missing image later (M6.1 fix). Runs in dry-run too, so the report already
 * shows which questions would fail before anything is written.
 */
export function checkQuestionImages(q: DraftQuestion, mediaByRid: MediaByRid): string[] {
  const errors: string[] = [];
  for (const rid of imageRefsOf(q)) {
    const media = mediaByRid.get(rid);
    if (!media) {
      errors.push(`image ${rid} is referenced but was not found in word/media`);
      continue;
    }
    const check = checkImageBytes(media.bytes, media.contentType);
    if (!check.ok) errors.push(`image ${rid}: ${check.reason}`);
  }
  return errors;
}
