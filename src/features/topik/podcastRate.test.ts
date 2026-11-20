import { describe, expect, it } from "vitest";
import { PODCAST_TTS_RATES, podcastTtsRate, rateForTrack } from "./podcastRate";

describe("the podcast's machine voice speed", () => {
  it("offers 1.0×, 0.9× and 0.8×, and starts at 0.8×", () => {
    expect(PODCAST_TTS_RATES).toEqual([1, 0.9, 0.8]);
    // The default is the slow one: the voice reads a question line faster than a learner follows.
    expect(podcastTtsRate.get()).toBe(0.8);
  });

  it("slows the machine voice only, never the exam's own recording", () => {
    expect(rateForTrack("file", 0.8)).toBe(0.8);
    // A real sitting plays the paper's tape at its own speed, whatever the voice is set to.
    expect(rateForTrack("clip", 0.8)).toBe(1);
    expect(rateForTrack("silence", 0.8)).toBe(1);
  });

  it("leaves everything at full speed when 1.0× is chosen", () => {
    for (const kind of ["file", "clip", "silence"] as const) expect(rateForTrack(kind, 1)).toBe(1);
  });
});
