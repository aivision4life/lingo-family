/**
 * Minimal HTTP Range support for the media route (M7.1). A TOPIK listening exam is one ~30 MB mp3
 * covering the whole paper, and practice plays a 30-second clip out of the middle of it — without
 * ranges the browser would download the entire file before the first sound.
 *
 * Only the single-range forms matter here, which is all `<audio>` ever sends:
 *   bytes=START-END   bytes=START-   bytes=-SUFFIX
 * Anything else (multiple ranges, another unit, a malformed header) returns `null`, and the caller
 * serves the whole object as before — a range is an optimisation, never a reason to fail.
 */
export type ByteRange = { offset: number; length: number };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Resolves a `Range` header against a known object size.
 * `null` = serve the whole object; `"unsatisfiable"` = the caller must answer 416.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const m = SINGLE_RANGE.exec(header.trim());
  if (!m) return null;
  const [, startText, endText] = m;
  if (startText === "" && endText === "") return null;

  if (startText === "") {
    // "bytes=-500": the last 500 bytes. A suffix longer than the file is the whole file, not an error.
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }

  const start = Number(startText);
  if (!Number.isFinite(start) || start >= size) return "unsatisfiable";
  // An end past the last byte is clamped rather than refused (RFC 9110 §14.1.1).
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  if (end < start) return "unsatisfiable";
  return { offset: start, length: end - start + 1 };
}

/** `Content-Range` value for a served range, e.g. "bytes 100-199/5000". */
export const contentRange = ({ offset, length }: ByteRange, size: number) => `bytes ${offset}-${offset + length - 1}/${size}`;
