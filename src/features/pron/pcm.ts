// Pure PCM helpers for the recorder (M3): microphone samples in, 16 kHz 16-bit samples out.

/** Joins the blocks a capture node delivered into one buffer. */
export function concatChunks(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Lowers the sample rate by averaging each output sample's span of input samples (a box filter:
 * enough anti-aliasing for speech, and exact for the usual 48 kHz → 16 kHz). Never raises a rate:
 * a microphone slower than the target is not something to paper over by inventing samples.
 */
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate) throw new RangeError(`cannot upsample ${fromRate} Hz to ${toRate} Hz`);
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = sum / (end - start);
  }
  return out;
}

/** Float samples in [-1, 1] to signed 16-bit, clipping anything louder instead of wrapping. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}
