import { describe, expect, it } from "vitest";
import { pickCover } from "./albums";

const m = (over: Partial<Parameters<typeof pickCover>[0][number]> = {}) => ({ image_key: null, image_status: "none" as const, emoji: null, ...over });

describe("pickCover", () => {
  it("the first word (in added order) with a ready image", () => {
    const cover = pickCover([m({ emoji: "🍎" }), m({ image_key: "images/ai/a.png", image_status: "ready" }), m({ image_key: "images/ai/b.png", image_status: "ready" })]);
    expect(cover).toMatchObject({ image_key: "images/ai/a.png", image_status: "ready" });
  });

  it("ignores images that are not ready; falls back to the first emoji, else none", () => {
    expect(pickCover([m({ image_key: "images/ai/x.png", image_status: "pending", emoji: "🏢" }), m({ emoji: "🏫" })])).toMatchObject({ image_key: null, emoji: "🏢" });
    expect(pickCover([m(), m()])).toBeNull();
    expect(pickCover([])).toBeNull();
  });
});
