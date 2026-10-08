// Reads the format and pixel size of a JPEG / PNG / WebP file from its header (no image library).

export type ImageInfo = { ext: "jpg" | "png" | "webp" | "bin"; width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

export function imageInfo(b: Uint8Array): ImageInfo {
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return { ext: "png", width: u32be(b, 16), height: u32be(b, 20) };

  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") return { ext: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (chunk === "VP8 ") return { ext: "webp", width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { ext: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  if (b[0] === 0xff && b[1] === 0xd8) {
    // Walk the JPEG segments until a start-of-frame marker (SOF0..SOF15 except DHT/JPG/DAC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) break;
      const marker = b[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { ext: "jpg", width: u16be(b, i + 7), height: u16be(b, i + 5) };
      }
      i += 2 + u16be(b, i + 2);
    }
    return { ext: "jpg", width: 0, height: 0 };
  }
  return { ext: "bin", width: 0, height: 0 };
}
