import { describe, expect, it } from "vitest";
import type { QueueItem } from "@shared/review";
import { upcomingMedia } from "./preload";

const item = (id: string, over: Partial<QueueItem["word"]> = {}, examples: QueueItem["examples"] = []): QueueItem =>
  ({ card: { id }, word: { audio_key: `audio/${id}.mp3`, image_key: `images/${id}.webp`, ...over }, examples }) as unknown as QueueItem;

describe("upcomingMedia", () => {
  const queue = [item("a"), item("b"), item("c"), item("d"), item("e")];

  it("covers the next 3 cards, not the current one", () => {
    const { images, audio } = upcomingMedia(queue, 0);
    expect(images).toEqual(["/api/media/images/b.webp", "/api/media/images/c.webp", "/api/media/images/d.webp"]);
    expect(audio).toHaveLength(3);
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
    expect(upcomingMedia(queue, 4)).toEqual({ images: [], audio: [] });
  });
});
