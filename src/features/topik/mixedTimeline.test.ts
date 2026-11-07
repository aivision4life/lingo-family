import { describe, expect, it } from "vitest";
import { mixedTimeline, positionOnTimeline, stitchedPosition } from "./mixedTimeline";

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

describe("positionOnTimeline", () => {
  const clips = [clip("a.mp3", 10_000, 30_000), clip("b.mp3", 0, 20_000), clip("c.mp3", 5_000, 15_000)];
  const timeline = mixedTimeline(clips.map((c, i) => ({ position: i + 1, clip: c })));

  it("finds the clip a stitched millisecond falls in, and how far into it", () => {
    expect(positionOnTimeline(clips, 0)).toEqual({ index: 0, withinMs: 0, past: false });
    expect(positionOnTimeline(clips, 25_000)).toEqual({ index: 0, withinMs: 25_000, past: false });
    expect(positionOnTimeline(clips, 35_000)).toEqual({ index: 1, withinMs: 5_000, past: false });
    expect(positionOnTimeline(clips, 55_000)).toEqual({ index: 2, withinMs: 5_000, past: false });
  });

  it("puts a boundary at the start of the clip that begins there, not the end of the one before", () => {
    expect(positionOnTimeline(clips, 30_000)).toEqual({ index: 1, withinMs: 0, past: false });
    expect(positionOnTimeline(clips, 50_000)).toEqual({ index: 2, withinMs: 0, past: false });
  });

  it("says the tape is past its end rather than pretending there is more to play", () => {
    expect(positionOnTimeline(clips, timeline.totalMs)).toMatchObject({ past: true });
    expect(positionOnTimeline(clips, timeline.totalMs + 60_000)).toMatchObject({ index: 2, past: true });
  });

  it("counts a clip shared by two questions once, like the timeline does", () => {
    const shared = clip("a.mp3", 10_000, 30_000);
    expect(positionOnTimeline([shared, { ...shared }, clip("b.mp3", 0, 20_000)], 35_000)).toEqual({
      index: 1,
      withinMs: 5_000,
      past: false,
    });
  });

  it("survives a paper with no clips at all", () => {
    expect(positionOnTimeline([], 1_000)).toEqual({ index: 0, withinMs: 0, past: true });
  });

  // The property that matters: the two directions must agree everywhere, not just at the few
  // milliseconds a hand-written example happens to pick.
  it("is the inverse of stitchedPosition, clip by clip and millisecond by millisecond", () => {
    for (const [index, c] of timeline.clips.entries()) {
      const length = c.end_ms - c.start_ms;
      for (const withinMs of [0, 1, 999, Math.floor(length / 2), length - 1]) {
        const stitched = stitchedPosition(timeline, index, withinMs);
        expect(positionOnTimeline(timeline.clips, stitched)).toEqual({ index, withinMs, past: false });
      }
    }
  });

  it("round-trips every millisecond of a short tape", () => {
    const short = [clip("a.mp3", 0, 3), clip("b.mp3", 100, 2)];
    const line = mixedTimeline(short.map((c, i) => ({ position: i + 1, clip: c })));
    for (let ms = 0; ms < line.totalMs; ms++) {
      const { index, withinMs } = positionOnTimeline(short, ms);
      expect(stitchedPosition(line, index, withinMs)).toBe(ms);
    }
  });
});
