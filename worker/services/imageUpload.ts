// Shared "My photo" upload path: already resized in the browser (SPEC F3), the server only
// re-checks and stores it content-addressed in R2 — used by word/phrase/example images (M1.8)
// and profile avatar photos (M2.10).
import { IMAGE_MAX_SIDE, IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_TYPES } from "../../shared/image";
import { imageInfo } from "../lib/imageInfo";

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export type StoredUpload = { key: string; contentType: string };
export type UploadLimits = { maxSide: number; maxBytes: number };

const DEFAULT_LIMITS: UploadLimits = { maxSide: IMAGE_MAX_SIDE, maxBytes: IMAGE_UPLOAD_MAX_BYTES };

/**
 * Validates an uploaded image's type/size/pixel dimensions and stores it under
 * `images/upload/<sha1>.<ext>` (shared, content-addressed: an identical upload used elsewhere,
 * e.g. for a word, is reused for free). Returns null when the upload is not a WebP/JPEG/PNG of at
 * most `limits.maxSide` px and `limits.maxBytes` (default: the word/phrase/example/avatar limits,
 * `IMAGE_MAX_SIDE`/`IMAGE_UPLOAD_MAX_BYTES`; TOPIK scans use their own, looser `limits`, M6.1).
 */
export async function storeUploadedImage(
  bucket: R2Bucket,
  bytes: Uint8Array,
  contentType: string,
  limits: UploadLimits = DEFAULT_LIMITS,
): Promise<StoredUpload | null> {
  const type = contentType.split(";")[0]!.trim();
  const info = imageInfo(bytes);
  const expected = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[type];
  const ok =
    (IMAGE_UPLOAD_TYPES as readonly string[]).includes(type) &&
    bytes.length > 0 && bytes.length <= limits.maxBytes &&
    info.ext === expected && info.width > 0 && info.height > 0 &&
    info.width <= limits.maxSide && info.height <= limits.maxSide;
  if (!ok) return null;

  const key = `images/upload/${hex(await crypto.subtle.digest("SHA-1", bytes))}.${info.ext}`;
  if (!(await bucket.head(key))) await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  return { key, contentType: type };
}
