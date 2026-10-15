// "My photo": shrink a picture in the browser before uploading (SPEC F3: ≤ 512 px, WebP).
import { IMAGE_MAX_SIDE, IMAGE_UPLOAD_MAX_BYTES } from "@shared/image";

/** Size that fits inside max × max, keeping the aspect ratio (never enlarges). */
export function fitWithin(width: number, height: number, max = IMAGE_MAX_SIDE) {
  if (width <= max && height <= max) return { width, height };
  const scale = max / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const QUALITIES = [0.85, 0.7, 0.55, 0.4];

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Resizes to ≤ `limits.maxSide` px (default 512) and encodes as WebP (JPEG on browsers that
 * cannot encode WebP), lowering the quality until the file is ≤ `limits.maxBytes` (default
 * 300 KB — TOPIK scans use their own, looser limit, M6.1). Throws "too_large" if that never works.
 */
export async function resizeForUpload(
  file: Blob,
  limits: { maxSide: number; maxBytes: number } = { maxSide: IMAGE_MAX_SIDE, maxBytes: IMAGE_UPLOAD_MAX_BYTES },
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitWithin(bitmap.width, bitmap.height, limits.maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of QUALITIES) {
    let blob = await encode(canvas, "image/webp", quality);
    if (blob && blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg", quality);
    if (blob && blob.size <= limits.maxBytes) return blob;
  }
  throw new Error("too_large");
}
