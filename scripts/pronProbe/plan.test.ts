import { describe, expect, it } from "vitest";
import { billedSeconds, hexHead, outBase, parseProbeArgs, probeOptions } from "./plan";

describe("pron-probe arguments", () => {
  it("a synthesized take is scored against its own text, in Korean by default", () => {
    expect(parseProbeArgs(["--tts", "사과"])).toEqual({
      lang: "ko",
      tts: "사과",
      file: null,
      text: "사과",
      concurrent: false,
      miscue: false,
      alphabet: undefined,
    });
  });

  it("--text overrides the reference, which is how a deliberate mismatch is tried", () => {
    expect(parseProbeArgs(["--tts", "사과", "--text", "사가", "--concurrent", "--miscue"])).toMatchObject({
      tts: "사과",
      text: "사가",
      concurrent: true,
      miscue: true,
    });
  });

  it("a file needs its reference text spelled out", () => {
    expect(parseProbeArgs(["--file", "take.wav"])).toMatchObject({ error: expect.stringContaining("--text") });
    expect(parseProbeArgs(["--file", "take.wav", "--text", "apple", "--lang", "en", "--alphabet", "IPA"])).toMatchObject({
      lang: "en",
      file: "take.wav",
      tts: null,
      text: "apple",
      alphabet: "IPA",
    });
  });

  it("refuses anything ambiguous instead of picking a default", () => {
    for (const args of [[], ["--tts"], ["--tts", "--concurrent"], ["--file"], ["--tts", "a", "--file", "b.wav"], ["--tts", "a", "--lang", "zh"], ["--tts", "a", "--alphabet", "X"]]) {
      expect(parseProbeArgs(args)).toHaveProperty("error");
    }
  });

  it("asks for prosody on en-US only", () => {
    expect(probeOptions({ lang: "en", miscue: false, alphabet: undefined }).prosody).toBe(true);
    expect(probeOptions({ lang: "ko", miscue: true, alphabet: undefined })).toEqual({ miscue: true, alphabet: undefined, prosody: false });
  });

  it("names output files sortably and in ASCII", () => {
    expect(outBase(new Date("2026-11-13T08:05:01.123Z"), "ko", "tts")).toBe("20261113-080501-ko-tts");
  });

  it("shows a header as hex beside its printable bytes, and stops at the count or the end", () => {
    const bytes = new Uint8Array(20);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0x24, 0x7d, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]); // "RIFF" size "WAVE"
    expect(hexHead(bytes)).toBe(
      ["0000  52 49 46 46 24 7d 00 00 57 41 56 45 00 00 00 00  RIFF$}..WAVE....", `0010  ${"00 00 00 00".padEnd(47)}  ....`].join("\n"),
    );
    expect(hexHead(bytes, 4)).toBe(`0000  ${"52 49 46 46".padEnd(47)}  RIFF`);
    expect(hexHead(new Uint8Array(0))).toBe("");
  });

  it("counts the take once per request", () => {
    expect(billedSeconds(1500, 1)).toBe(1.5);
    expect(billedSeconds(1500, 2)).toBe(3);
  });
});
