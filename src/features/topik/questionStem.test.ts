import { describe, expect, it } from "vitest";
import { sharedStem, stemView } from "./questionStem";

describe("stemView", () => {
  // The bug this file exists for: a reading sitting showed four options and nothing to read.
  it("shows a reading question's text, which is the question itself", () => {
    const stem = { text: "저는 어제 책을 (  ).", image_key: null };
    expect(stemView(stem, { hasClip: false })).toEqual(stem);
  });

  it("shows a reading question's image on its own", () => {
    const stem = { text: null, image_key: "topik/stem/notice.png" };
    expect(stemView(stem, { hasClip: false })).toEqual(stem);
  });

  it("shows text and image together", () => {
    const stem = { text: "다음 안내를 보고 물음에 답하십시오.", image_key: "topik/stem/notice.png" };
    expect(stemView(stem, { hasClip: false })).toEqual(stem);
  });

  // A listening stem is the transcript; the server sends null for it until the group is answered.
  it("shows nothing when there is nothing to show", () => {
    expect(stemView({ text: null, image_key: null }, { hasClip: false })).toBeNull();
  });

  // Belt and braces: the clip is on the screen above, and its transcript must never be printed
  // over the questions it answers, whatever the server sent.
  it("shows nothing for a question with a recording, even if the text came through", () => {
    expect(stemView({ text: "남자: 안녕하세요.", image_key: null }, { hasClip: true })).toBeNull();
  });
});

// M7.21: a reading pair's passage is stored on both questions, so one screen would print it twice.
describe("sharedStem", () => {
  const passage = { text: "과일을 빨리 익히기 위해", image_key: null };

  it("is the passage when both questions carry the same one", () => {
    expect(sharedStem([passage, { ...passage }])).toEqual(passage);
  });

  it("is null when the two stems differ, even slightly", () => {
    // The two copies drifting apart is a real possibility (SPEC §10); when they have, each
    // question shows its own text rather than one of them standing in for the other.
    expect(sharedStem([passage, { text: passage.text + " ", image_key: null }])).toBeNull();
  });

  it("is null for a group of one — there is nothing to share", () => {
    expect(sharedStem([passage])).toBeNull();
  });

  it("is null for a listening pair, whose stems are withheld", () => {
    expect(sharedStem([null, null])).toBeNull();
  });

  it("is null when one question of the pair has no stem at all", () => {
    expect(sharedStem([passage, null])).toBeNull();
  });

  it("shares an image stem too — one chart asked about twice is one chart", () => {
    const chart = { text: null, image_key: "topik/img/a.webp" };
    expect(sharedStem([chart, { ...chart }])).toEqual(chart);
    expect(sharedStem([chart, { text: null, image_key: "topik/img/b.webp" }])).toBeNull();
  });
});
