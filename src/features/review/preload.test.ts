import { describe, expect, it } from "vitest";
import type { QueueItem } from "@shared/review";
import { BULK_CARDS, bulkMedia, mediaOf, upcomingMedia, WINDOW_CARDS } from "./preload";

const item = (id: string, over: Partial<QueueItem["word"]> = {}, examples: QueueItem["examples"] = []): QueueItem =>
  ({ card: { id }, word: { audio_key: `audio/${id}.mp3`, image_key: `images/${id}.webp`, ...over }, examples }) as unknown as QueueItem;

const many = (n: number) => Array.from({ length: n }, (_, i) => item(`c${i}`));

describe("upcomingMedia (the window while reviewing)", () => {
  const queue = [item("a"), item("b"), item("c"), item("d"), item("e"), item("f"), item("g")];

  it("covers the next 4 cards, not the current one", () => {
    expect(WINDOW_CARDS).toBe(4);
    const { images, audio } = upcomingMedia(queue, 0);
    expect(images).toEqual(["b", "c", "d", "e"].map((k) => `/api/media/images/${k}.webp`));
    expect(audio).toHaveLength(4);
    expect(audio).not.toContain("/api/media/audio/a.mp3");
  });

  it("skips missing media, includes drawn example images and example audio", () => {
    const ex = [
      { image_key: "images/x.webp", audio_key: "audio/x.mp3" },
      { image_key: null, audio_key: null },
    ] as unknown as QueueItem["examples"];
    const q = [item("a"), item("b", { image_key: null }, ex)];
    const { images, audio } = upcomingMedia(q, 0);
    expect(images).toEqual(["/api/media/images/x.webp"]);
    expect(audio).toEqual(["/api/media/audio/b.mp3", "/api/media/audio/x.mp3"]);
  });

  it("is empty at the end of the queue", () => {
    expect(upcomingMedia(queue, 6)).toEqual({ images: [], audio: [] });
  });

  it("reaches cards beyond the first 30 as the review advances", () => {
    const q = many(40);
    expect(upcomingMedia(q, 29).images).toContain("/api/media/images/c33.webp");
    expect(bulkMedia(q, false).images).not.toContain("/api/media/images/c33.webp");
  });
});

describe("bulkMedia (session start)", () => {
  it("takes at most the first 30 cards", () => {
    expect(BULK_CARDS).toBe(30);
    const { images, audio } = bulkMedia(many(50), false);
    expect(images).toHaveLength(30);
    expect(audio).toHaveLength(30);
    expect(images[29]).toBe("/api/media/images/c29.webp");
  });

  it("does nothing when the device saves data; the window still works", () => {
    expect(bulkMedia(many(50), true)).toEqual({ images: [], audio: [] });
    expect(upcomingMedia(many(50), 0).images).toHaveLength(WINDOW_CARDS);
  });

  it("removes duplicate URLs (items sharing an image)", () => {
    const q = [item("a", { image_key: "images/same.webp" }), item("b", { image_key: "images/same.webp" })];
    expect(mediaOf(q).images).toEqual(["/api/media/images/same.webp"]);
  });
});
