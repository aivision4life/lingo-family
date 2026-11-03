import { describe, expect, it } from "vitest";
import { mixedTimeline, stitchedPosition } from "./mixedTimeline";

const clip = (audio_key: string, start_ms: number, length: number, silence = 0) => ({
  audio_key,
  start_ms,
  speech_end_ms: start_ms + length - silence,
  end_ms: start_ms + length,
});

describe("mixedTimeline", () => {
  it("lays the clips end to end, whatever file they come from", () => {
    const timeline = mixedTimeline([
      { position: 1, clip: clip("a.mp3", 10_000, 30_000) },
      { position: 2, clip: clip("b.mp3", 0, 20_000) },
    ]);
    expect(timeline.offsets).toEqual([0, 30_000]);
    expect(timeline.totalMs).toBe(50_000);
    expect(timeline.positions[1]!.clip).toMatchObject({ start_ms: 30_000, end_ms: 50_000 });
  });

  it("keeps each clip's own answering silence", () => {
    const timeline = mixedTimeline([{ position: 1, clip: clip("a.mp3", 5_000, 30_000, 18_000) }]);
    expect(timeline.positions[0]!.clip).toMatchObject({ start_ms: 0, speech_end_ms: 12_000, end_ms: 30_000 });
  });

  it("plays a shared clip once and points both questions at it", () => {
    const shared = clip("a.mp3", 0, 40_000);
    const timeline = mixedTimeline([
      { position: 21, clip: shared },
      { position: 22, clip: shared },
      { position: 23, clip: clip("b.mp3", 0, 10_000) },
    ]);
    expect(timeline.clips).toHaveLength(2);
    expect(timeline.positions[0]!.clip).toEqual(timeline.positions[1]!.clip);
    expect(timeline.positions[2]!.clip).toMatchObject({ start_ms: 40_000 });
  });

  it("does not confuse two clips that start at the same time in different files", () => {
    const timeline = mixedTimeline([
      { position: 1, clip: clip("a.mp3", 0, 10_000) },
      { position: 2, clip: clip("b.mp3", 0, 10_000) },
    ]);
    expect(timeline.clips).toHaveLength(2);
    expect(timeline.totalMs).toBe(20_000);
  });

  it("survives a question with no clip at all", () => {
    const timeline = mixedTimeline([{ position: 1, clip: null }]);
    expect(timeline).toMatchObject({ clips: [], totalMs: 0 });
    expect(timeline.positions[0]!.clip).toBeNull();
  });
});

describe("stitchedPosition", () => {
  const timeline = mixedTimeline([
    { position: 1, clip: clip("a.mp3", 10_000, 30_000) },
    { position: 2, clip: clip("b.mp3", 0, 20_000) },
  ]);

  it("adds the clip's offset to how far into it the tape is", () => {
    expect(stitchedPosition(timeline, 1, 5_000)).toBe(35_000);
  });

  it("never runs past the end of the tape", () => {
    expect(stitchedPosition(timeline, 1, 99_000)).toBe(50_000);
  });

  it("reads the end of the paper once the tape is past its last clip", () => {
    expect(stitchedPosition(timeline, 2, 0)).toBe(50_000);
  });
});
