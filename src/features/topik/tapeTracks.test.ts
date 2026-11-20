import { describe, expect, it } from "vitest";
import { clipTracks, elementSlots, type TapeTrack } from "./tapeTracks";

const file = (audio_key: string): TapeTrack => ({ kind: "file", audio_key });
const gap = (ms = 5_000): TapeTrack => ({ kind: "silence", ms });
const clip = (audio_key: string): TapeTrack => ({ kind: "clip", audio_key, start_ms: 0, speech_end_ms: 20_000, end_ms: 25_000 });

describe("clipTracks", () => {
  it("turns a paper's clips into a playlist, in order", () => {
    const tracks = clipTracks([
      { audio_key: "a.mp3", start_ms: 0, speech_end_ms: 10, end_ms: 20 },
      { audio_key: "b.mp3", start_ms: 20, speech_end_ms: 30, end_ms: 40 },
    ]);
    expect(tracks.map((t) => t.kind)).toEqual(["clip", "clip"]);
    expect(elementSlots(tracks)).toEqual([0, 1]);
  });
});

describe("elementSlots", () => {
  it("alternates the two elements over a playlist of nothing but clips", () => {
    expect(elementSlots([clip("a"), clip("b"), clip("c"), clip("d")])).toEqual([0, 1, 0, 1]);
  });

  it("gives a silent gap no element at all", () => {
    expect(elementSlots([gap()])).toEqual([null]);
    expect(elementSlots([])).toEqual([]);
  });

  /**
   * The bug this function exists for. A podcast question is number, question line, clip, options,
   * gap, answer: counting by track index gave the gap a slot, so the options (3) and the answer
   * (5) both came out on element 1 and preparing the answer re-sourced the element the options
   * were playing on.
   */
  it("does not let the options and the answer of a question share an element", () => {
    const question = [file("number"), file("line"), clip("exam"), file("options"), gap(), file("answer")];
    expect(elementSlots(question)).toEqual([0, 1, 0, 1, null, 0]);
  });

  it("counts on past the gap, so the next question starts where the last one left off", () => {
    const question = [file("number"), file("line"), clip("exam"), file("options"), gap(), file("answer")];
    expect(elementSlots([...question, ...question])).toEqual([0, 1, 0, 1, null, 0, 1, 0, 1, 0, null, 1]);
  });

  it("never gives two tracks that are heard one after the other the same element", () => {
    // Every arrangement of three gaps among six audio tracks: the gaps may fall anywhere, and no
    // two sounds that follow each other may ever land on one element.
    const audio = [file("a"), file("b"), clip("c"), file("d"), file("e"), file("f")];
    for (let mask = 0; mask < 1 << 6; mask += 1) {
      const tracks: TapeTrack[] = [];
      audio.forEach((track, i) => {
        tracks.push(track);
        if (mask & (1 << i)) tracks.push(gap());
      });
      const heard = elementSlots(tracks).filter((slot) => slot !== null);
      for (let i = 1; i < heard.length; i += 1) expect(heard[i]).not.toBe(heard[i - 1]);
    }
  });
});
