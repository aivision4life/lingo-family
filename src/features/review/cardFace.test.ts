import { describe, expect, it } from "vitest";
import { autoPlaysOnFront, cardFace } from "./cardFace";

describe("cardFace", () => {
  it("recognition: word on the front without image; image + meaning on the back", () => {
    expect(cardFace("recognition", false)).toEqual({ image: false, term: true, bigSpeaker: false, meaning: false });
    expect(cardFace("recognition", true)).toEqual({ image: true, term: true, bigSpeaker: false, meaning: true });
  });
  it("picture: image only on the front; word + meaning on the back", () => {
    expect(cardFace("picture", false)).toEqual({ image: true, term: false, bigSpeaker: false, meaning: false });
    expect(cardFace("picture", true)).toEqual({ image: true, term: true, bigSpeaker: false, meaning: true });
  });
  it("listening: big speaker only on the front; everything on the back", () => {
    expect(cardFace("listening", false)).toEqual({ image: false, term: false, bigSpeaker: true, meaning: false });
    expect(cardFace("listening", true)).toEqual({ image: true, term: true, bigSpeaker: false, meaning: true });
  });
  it("speaking: image + the text to read on the front, meaning on the back", () => {
    expect(cardFace("speaking", false)).toEqual({ image: true, term: true, bigSpeaker: false, meaning: false });
    expect(cardFace("speaking", true)).toEqual({ image: true, term: true, bigSpeaker: false, meaning: true });
  });
  it("picture and speaking cards do not auto-play on the front", () => {
    expect(autoPlaysOnFront("picture")).toBe(false);
    expect(autoPlaysOnFront("speaking")).toBe(false);
    expect(autoPlaysOnFront("recognition")).toBe(true);
  });
});
