// A tiny valid WebP (VP8X header, 10×10) for exercising the generic "My photo" upload validation
// (M1.8 word/phrase/example images, M2.10 profile avatar photos). Shared so both test files use
// the exact same bytes/offsets.
export const FAKE_WEBP = Uint8Array.from(
  [..."RIFF\0\0\0\0WEBPVP8X"].map((ch) => ch.charCodeAt(0)).concat([10, 0, 0, 0, 0, 0, 0, 0, 0xff, 1, 0, 0xff, 1, 0]),
);

/** Same bytes but claiming 1024×1024 (over `IMAGE_MAX_SIDE`). */
export function oversizedWebp(): Uint8Array {
  const b = Uint8Array.from(FAKE_WEBP);
  b.set([0xff, 3, 0], 24);
  return b;
}
