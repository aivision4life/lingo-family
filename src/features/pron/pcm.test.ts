import { describe, expect, it } from "vitest";
import { concatChunks, downsample, floatToInt16 } from "./pcm";

describe("PCM helpers", () => {
  it("joins capture blocks in order", () => {
    expect([...concatChunks([Float32Array.from([1, 2]), new Float32Array(0), Float32Array.from([3])])]).toEqual([1, 2, 3]);
  });

  it("48 kHz → 16 kHz averages every three samples", () => {
    const out = downsample(Float32Array.from([0, 3, 6, 9, 9, 9, 1, 1, 1]), 48_000, 16_000);
    expect([...out]).toEqual([3, 9, 1]);
  });

  it("44.1 kHz → 16 kHz keeps the duration", () => {
    const out = downsample(new Float32Array(44_100).fill(0.5), 44_100, 16_000);
    expect(out.length).toBe(16_000);
    expect(out.every((s) => Math.abs(s - 0.5) < 1e-6)).toBe(true);
  });

  it("leaves a matching rate alone and refuses to invent samples", () => {
    const same = Float32Array.from([0.1, 0.2]);
    expect(downsample(same, 16_000, 16_000)).toBe(same);
    expect(() => downsample(same, 8_000, 16_000)).toThrow(RangeError);
  });

  it("converts to 16-bit and clips instead of wrapping", () => {
    expect([...floatToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))]).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
});
