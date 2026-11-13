// WAV (PCM 16-bit mono) for pronunciation scoring (M3). The browser encodes with `encodeWav`, the
// Worker re-checks with `checkWav` before any paid call: one definition of "a recording we accept".

/** Azure's short-audio REST API takes 16 kHz mono PCM. */
export const PRON_SAMPLE_RATE = 16_000;
/**
 * Longest take we score. **Our budget, not Azure's ceiling** (Azure itself allows 30 s).
 *
 * Azure's free tier (F0) gives 5 hours of audio a month for ALL speech-to-text of the whole family,
 * about 18,000 seconds. At 100 takes x 30 s one profile would use a month's allowance in 6 days,
 * four profiles in a day and a half. And this is the one paid call in the app that cannot be
 * cached (every take is new audio), so the daily quota (shared/pron.ts) and this length are the
 * only fence there is. 8 s covers a word, a phrase or one example sentence.
 * Enforced on both sides: the recorder cuts a take here, and the Worker refuses a longer one.
 */
export const PRON_MAX_SECONDS = 8;

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
/** Largest file a full-length take can be: its samples plus room for header chunks (257,024). */
export const PRON_MAX_BYTES = PRON_MAX_SECONDS * PRON_SAMPLE_RATE * BYTES_PER_SAMPLE + 1024;

const ascii = (view: DataView, offset: number, text: string) => {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
};

/** Canonical 44-byte-header WAV: PCM, mono, 16-bit little-endian. */
export function encodeWav(samples: Int16Array, sampleRate = PRON_SAMPLE_RATE): ArrayBuffer {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  ascii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(view, 8, "WAVE");
  ascii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(HEADER_BYTES + i * BYTES_PER_SAMPLE, samples[i]!, true);
  return buffer;
}

export type WavCheck = { ok: true; durationMs: number } | { ok: false; reason: string };

const tag = (view: DataView, offset: number) =>
  String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

/**
 * Is this a recording we are willing to pay Azure to score? PCM, mono, 16 kHz, 16-bit, not empty,
 * not longer than `PRON_MAX_SECONDS` — one limit, for the app and for `npm run pron-probe` alike.
 * Walks the chunks instead of assuming the 44-byte layout, so a WAV with an extra `LIST` chunk
 * still reads correctly.
 *
 * Two limits, in this order, and the order is the point:
 *
 * 1. **Bytes — measured.** The size of the upload is a fact nobody can argue with, and it bounds
 *    what can be sent on to Azure, which bills the audio it actually processes, not the number a
 *    file claims. It runs first, unconditionally, and depends on nothing the file says.
 * 2. **Duration — declared, and by then known to be true.** The length comes from the size the
 *    `data` chunk states about itself. With the byte check in front it is no longer a cost fence
 *    (no more than ~8.03 s of real audio can get this far), so its one job is to tell the truth:
 *    - declared > available (the header claims more audio than the file holds) → **refused**, as
 *      its own error naming both numbers. `encodeWav` writes declared = actual by construction, so
 *      a difference can only be an encoder bug, an upload cut short, or something not understood
 *      yet. All three must be loud: accepting it quietly spends a quota unit and returns a low
 *      score for a recording that was cut off, and the learner concludes they mispronounced it.
 *    - declared <= available → accepted, and the declared size is the duration. Bytes after the
 *      audio are another chunk or padding, and harmless (the byte check already bounded them).
 *    Only one direction is dangerous, which is why the rule is not symmetric.
 *
 * The check that cannot be fooled must never wait behind the one that can.
 */
export function checkWav(bytes: Uint8Array): WavCheck {
  const no = (reason: string): WavCheck => ({ ok: false, reason });
  if (bytes.length > PRON_MAX_BYTES) {
    return no(`too large: ${bytes.length} bytes, and a take of ${PRON_MAX_SECONDS} s is at most ${PRON_MAX_BYTES}`);
  }
  if (bytes.length < HEADER_BYTES) return no("too short to be a WAV file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") return no("not a RIFF/WAVE file");

  let fmtSeen = false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (body + 16 > bytes.length) return no("truncated fmt chunk");
      if (view.getUint16(body, true) !== 1) return no("not PCM");
      if (view.getUint16(body + 2, true) !== 1) return no("not mono");
      if (view.getUint32(body + 4, true) !== PRON_SAMPLE_RATE) return no(`sample rate is not ${PRON_SAMPLE_RATE}`);
      if (view.getUint16(body + 14, true) !== 16) return no("not 16-bit");
      fmtSeen = true;
    } else if (id === "data") {
      if (!fmtSeen) return no("data chunk before fmt chunk");
      // Never min(declared, available): see the comment above. This also refuses a streamed
      // header (size 0xFFFFFFFF) on purpose — nobody has measured one here yet.
      const available = bytes.length - body;
      if (size > available) return no(`header declares ${size} bytes of audio, but only ${available} are in the file`);
      // From here on declared = what the file really holds, so the declared size is the duration.
      // A declared size of 0 is "no audio", whatever follows it.
      const samples = Math.floor(size / BYTES_PER_SAMPLE);
      if (samples === 0) return no("no audio");
      const durationMs = Math.round((samples / PRON_SAMPLE_RATE) * 1000);
      if (durationMs > PRON_MAX_SECONDS * 1000) {
        return no(`declares ${(durationMs / 1000).toFixed(2)} s of audio, longer than ${PRON_MAX_SECONDS} s`);
      }
      return { ok: true, durationMs };
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  return no("no data chunk");
}
