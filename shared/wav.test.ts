import { describe, expect, it } from "vitest";
import { checkWav, encodeWav, PRON_MAX_BYTES, PRON_MAX_SECONDS, PRON_SAMPLE_RATE } from "./wav";

const seconds = (s: number) => new Int16Array(Math.round(s * PRON_SAMPLE_RATE)).fill(1000);
const wav = (samples: Int16Array, rate?: number) => new Uint8Array(encodeWav(samples, rate));

/** Overwrites one little-endian header field of an otherwise valid file. */
const patched = (offset: number, value: number, size: 2 | 4) => {
  const bytes = wav(seconds(1));
  const view = new DataView(bytes.buffer);
  if (size === 2) view.setUint16(offset, value, true);
  else view.setUint32(offset, value, true);
  return bytes;
};

describe("WAV for pronunciation scoring", () => {
  it("what the browser encodes is what the Worker accepts, with the right length", () => {
    expect(checkWav(wav(seconds(1.5)))).toEqual({ ok: true, durationMs: 1500 });
  });

  it("keeps the samples, little-endian, after a 44-byte header", () => {
    const bytes = wav(Int16Array.from([1, -2, 32767, -32768]));
    expect(bytes.length).toBe(44 + 8);
    const view = new DataView(bytes.buffer);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([1, -2, 32767, -32768]);
  });

  it("accepts exactly the maximum length and refuses anything past it", () => {
    expect(checkWav(wav(seconds(PRON_MAX_SECONDS)))).toMatchObject({ ok: true });
    // An honest take just past the limit still fits in the byte allowance's slack, so the length
    // it declares is what stops it; one far past the limit never gets beyond the byte check.
    expect(checkWav(wav(seconds(PRON_MAX_SECONDS + 0.01)))).toEqual({
      ok: false,
      reason: `declares ${PRON_MAX_SECONDS}.01 s of audio, longer than ${PRON_MAX_SECONDS} s`,
    });
    expect(checkWav(wav(seconds(PRON_MAX_SECONDS + 3)))).toMatchObject({ ok: false, reason: expect.stringMatching(/^too large: /) });
  });

  // The two limits against a header that lies, one lie each way (see the comment on checkWav).
  it("a header claiming 3 s on a file bigger than a full take is stopped by the byte check", () => {
    const bytes = wav(seconds(PRON_MAX_SECONDS + 3));
    new DataView(bytes.buffer).setUint32(40, 3 * PRON_SAMPLE_RATE * 2, true); // "data" declares 3 s
    expect(bytes.length).toBeGreaterThan(PRON_MAX_BYTES);
    expect(checkWav(bytes)).toEqual({
      ok: false,
      reason: `too large: ${bytes.length} bytes, and a take of ${PRON_MAX_SECONDS} s is at most ${PRON_MAX_BYTES}`,
    });
  });

  it("a header claiming more audio than the file holds is refused, naming both numbers", () => {
    const bytes = wav(seconds(1));
    new DataView(bytes.buffer).setUint32(40, 20 * PRON_SAMPLE_RATE * 2, true); // "data" declares 20 s, 1 s is there
    expect(bytes.length).toBeLessThan(PRON_MAX_BYTES); // the byte check has nothing to say about it
    expect(checkWav(bytes)).toEqual({ ok: false, reason: "header declares 640000 bytes of audio, but only 32000 are in the file" });
  });

  it("refuses a streamed header that declares no real length (0xFFFFFFFF) rather than guessing", () => {
    const bytes = wav(seconds(1));
    new DataView(bytes.buffer).setUint32(40, 0xffffffff, true);
    expect(checkWav(bytes)).toEqual({ ok: false, reason: "header declares 4294967295 bytes of audio, but only 32000 are in the file" });
  });

  it("accepts bytes after the audio and takes the declared size as the duration", () => {
    const bytes = wav(seconds(2));
    new DataView(bytes.buffer).setUint32(40, PRON_SAMPLE_RATE * 2, true); // "data" declares 1 s, 2 s of bytes follow
    expect(checkWav(bytes)).toEqual({ ok: true, durationMs: 1000 });
  });

  it("refuses what Azure would refuse, each for its own reason", () => {
    expect(checkWav(wav(seconds(1), 48_000))).toMatchObject({ ok: false, reason: expect.stringContaining("sample rate") });
    expect(checkWav(patched(20, 3, 2))).toEqual({ ok: false, reason: "not PCM" });
    expect(checkWav(patched(22, 2, 2))).toEqual({ ok: false, reason: "not mono" });
    expect(checkWav(patched(34, 8, 2))).toEqual({ ok: false, reason: "not 16-bit" });
    expect(checkWav(wav(new Int16Array(0)))).toEqual({ ok: false, reason: "no audio" });
    expect(checkWav(new TextEncoder().encode("x".repeat(100)))).toMatchObject({ ok: false, reason: expect.stringContaining("RIFF") });
    expect(checkWav(new Uint8Array(10))).toMatchObject({ ok: false });
  });

  it("reads a file with an extra chunk before the audio", () => {
    const plain = wav(seconds(1));
    const extra = new Uint8Array(8 + 6); // "LIST" + size 5 + 5 bytes + 1 pad byte
    extra.set([0x4c, 0x49, 0x53, 0x54, 5, 0, 0, 0]);
    const withList = new Uint8Array(plain.length + extra.length);
    withList.set(plain.subarray(0, 36));
    withList.set(extra, 36);
    withList.set(plain.subarray(36), 36 + extra.length);
    expect(checkWav(withList)).toEqual({ ok: true, durationMs: 1000 });
  });

  it("believes a header that declares no audio, even with bytes after it", () => {
    const bytes = wav(seconds(1));
    new DataView(bytes.buffer).setUint32(40, 0, true);
    expect(checkWav(bytes)).toEqual({ ok: false, reason: "no audio" });
  });

  it("refuses a short take padded out with something that is not audio", () => {
    const plain = wav(seconds(1));
    const junk = PRON_MAX_SECONDS * PRON_SAMPLE_RATE * 2; // as many bytes again as a full-length take
    const padded = new Uint8Array(plain.length + 8 + junk);
    padded.set(plain.subarray(0, 36));
    padded.set([0x4c, 0x49, 0x53, 0x54], 36); // "LIST"
    new DataView(padded.buffer).setUint32(40, junk, true);
    padded.set(plain.subarray(36), 36 + 8 + junk);
    expect(checkWav(padded)).toMatchObject({ ok: false, reason: expect.stringMatching(/^too large: /) });
  });

  // Used to be accepted as "1 s of audio". A take cut off mid-upload scores low for a reason that
  // has nothing to do with pronunciation, so it must be refused out loud, never scored quietly.
  it("refuses an upload that was cut short, even inside the limit", () => {
    const cut = wav(seconds(2)).subarray(0, 44 + PRON_SAMPLE_RATE * 2); // header says 2 s, 1 s is there
    expect(checkWav(cut)).toEqual({ ok: false, reason: "header declares 64000 bytes of audio, but only 32000 are in the file" });
  });
});
