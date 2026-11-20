// How fast the podcast's machine voice reads (SPEC F13). Its own setting, not the app-wide speed
// button: what is too fast here is the TTS, while the exam's own recording must stay at the speed
// a real sitting plays it at. Speed is the browser's `playbackRate`, so no audio is regenerated —
// changing it costs no Azure quota and no R2 file.
import { createRateSetting } from "@/features/audio/rateSetting";

/** 0.8× by default: the voice reads a question line faster than a learner can follow it. */
export const PODCAST_TTS_RATES = [1, 0.9, 0.8, 0.7] as const;
export type PodcastTtsRate = (typeof PODCAST_TTS_RATES)[number];

export const podcastTtsRate = createRateSetting("podcast_tts_rate", PODCAST_TTS_RATES, 0.8);

/** The speed a track plays at: the machine voice's setting for TTS, real time for the exam's clip. */
export const rateForTrack = (kind: "clip" | "file" | "silence", ttsRate: number) => (kind === "file" ? ttsRate : 1);
