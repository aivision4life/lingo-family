import { describe, expect, it } from "vitest";
import { stemView } from "./questionStem";

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
