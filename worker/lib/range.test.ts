import { describe, expect, it } from "vitest";
import { contentRange, parseByteRange } from "./range";

describe("parseByteRange", () => {
  const SIZE = 1000;

  it("reads a closed range", () => {
    expect(parseByteRange("bytes=100-199", SIZE)).toEqual({ offset: 100, length: 100 });
  });

  it("reads an open-ended range (everything from an offset)", () => {
    expect(parseByteRange("bytes=900-", SIZE)).toEqual({ offset: 900, length: 100 });
  });

  it("reads a suffix range (the last N bytes)", () => {
    expect(parseByteRange("bytes=-250", SIZE)).toEqual({ offset: 750, length: 250 });
    // Asking for more trailing bytes than exist is the whole file, not an error.
    expect(parseByteRange("bytes=-5000", SIZE)).toEqual({ offset: 0, length: SIZE });
  });

  it("clamps an end past the last byte instead of refusing it", () => {
    expect(parseByteRange("bytes=990-5000", SIZE)).toEqual({ offset: 990, length: 10 });
  });

  it("reports an unsatisfiable range so the caller can answer 416", () => {
    expect(parseByteRange("bytes=1000-", SIZE)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=500-400", SIZE)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", SIZE)).toBe("unsatisfiable");
  });

  // A range we do not understand must fall back to the whole file: playback still works, it just
  // is not optimised. Multi-range responses would need multipart/byteranges, which nothing sends.
  it("falls back to the whole object for anything it does not handle", () => {
    expect(parseByteRange(null, SIZE)).toBeNull();
    expect(parseByteRange("", SIZE)).toBeNull();
    expect(parseByteRange("bytes=0-99, 200-299", SIZE)).toBeNull();
    expect(parseByteRange("items=0-99", SIZE)).toBeNull();
    expect(parseByteRange("bytes=-", SIZE)).toBeNull();
    expect(parseByteRange("rubbish", SIZE)).toBeNull();
  });
});

describe("contentRange", () => {
  it("formats the served range against the full size", () => {
    expect(contentRange({ offset: 100, length: 100 }, 1000)).toBe("bytes 100-199/1000");
    expect(contentRange({ offset: 0, length: 1 }, 1)).toBe("bytes 0-0/1");
  });
});
