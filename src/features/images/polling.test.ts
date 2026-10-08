import { describe, expect, it } from "vitest";
import { IMAGE_STALE_MS, type ImageView } from "@shared/image";
import { isFreshPending, isStalePending, POLL_MS, pollWhilePending } from "./api";

const now = 1_000_000_000;
const img = (over: Partial<ImageView>): ImageView => ({
  image_key: null, image_status: "none", image_prompt: null, image_source: null, image_requested_at: null, ...over,
});

describe("image polling", () => {
  it("polls every 3 s only while something was claimed recently", () => {
    const poll = pollWhilePending((list: ImageView[]) => list);
    const fresh = img({ image_status: "pending", image_requested_at: Date.now() - 5_000 });
    expect(poll({ state: { data: [img({}), fresh] } })).toBe(POLL_MS);
    expect(poll({ state: { data: [img({ image_status: "ready", image_key: "k" })] } })).toBe(false);
    expect(poll({ state: { data: undefined } })).toBe(false);
  });

  it("a pending item older than 2 minutes is stale (taken over by ensure), not polled forever", () => {
    const old = img({ image_status: "pending", image_requested_at: now - IMAGE_STALE_MS - 1 });
    expect(isStalePending(old, now)).toBe(true);
    expect(isFreshPending(img({ image_status: "pending", image_requested_at: now - IMAGE_STALE_MS - 61_000 }), now)).toBe(false);
    expect(isStalePending(img({ image_status: "pending", image_requested_at: now - 1000 }), now)).toBe(false);
  });
});
