// Microphone → 16 kHz mono WAV, entirely on the device (M3).
//
// Not MediaRecorder: it produces mp4/AAC on iOS and webm/Opus on Chrome, and Azure's short-audio
// API accepts neither. So the raw samples are taken from an AudioWorklet (a small audio-thread
// script) and encoded here; the same WAV is what gets scored and what "Compare" plays back.
import { encodeWav, PRON_MAX_SECONDS, PRON_SAMPLE_RATE } from "@shared/wav";
import { concatChunks, downsample, floatToInt16 } from "./pcm";

// Kept as a string and loaded from a Blob URL: a worklet must be its own module, and this way it
// is not one more hashed asset for the service worker to get right.
const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export type Recording = {
  wav: Blob;
  durationMs: number;
  /** The microphone's own rate, before downsampling (shown by the probe). */
  sourceRate: number;
};

export type ActiveRecording = {
  /** Stops, releases the microphone and returns the take. */
  stop(): Promise<Recording>;
  /** Stops and throws the take away. */
  cancel(): void;
};

/**
 * Starts recording. Call it **directly from a tap**: the AudioContext is created before the first
 * `await`, while the gesture is still live — a phone leaves a context made later suspended, and a
 * suspended context records silence without any error.
 */
export async function startRecording(): Promise<ActiveRecording> {
  const ctx = new AudioContext();
  let stream: MediaStream | null = null;
  const chunks: Float32Array[] = [];

  const release = () => {
    stream?.getTracks().forEach((track) => track.stop());
    void ctx.close().catch(() => {});
  };

  try {
    const resumed = ctx.resume();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    await resumed;

    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const node = new AudioWorkletNode(ctx, "pcm-capture");
    node.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.push(e.data);
    // Through a silent gain to the output: some browsers only run a node that leads somewhere.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(node).connect(mute).connect(ctx.destination);
  } catch (e) {
    release();
    throw e;
  }

  const sourceRate = ctx.sampleRate;
  return {
    async stop() {
      release();
      // Cut at the limit the Worker enforces: a stop that lands a few milliseconds late must not
      // turn a full-length take into a refused one.
      const all = floatToInt16(downsample(concatChunks(chunks), sourceRate, PRON_SAMPLE_RATE));
      const samples = all.subarray(0, PRON_MAX_SECONDS * PRON_SAMPLE_RATE);
      return {
        wav: new Blob([encodeWav(samples)], { type: "audio/wav" }),
        durationMs: Math.round((samples.length / PRON_SAMPLE_RATE) * 1000),
        sourceRate,
      };
    },
    cancel: release,
  };
}
