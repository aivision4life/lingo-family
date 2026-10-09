// Preloads the images and audio of the next few cards so flipping never waits (M1.9).
import { useEffect } from "react";
import type { QueueItem } from "@shared/review";
import { mediaUrl } from "@/features/audio/player";
import { imageUrl } from "@/features/images/api";

export const PRELOAD_AHEAD = 3;

/**
 * Media URLs of the cards after `pos`: word / phrase image and audio, plus example images that are
 * already drawn and example audio. Never asks for drawing (that is ItemImage's job, and costs quota).
 */
export function upcomingMedia(queue: QueueItem[], pos: number, ahead = PRELOAD_AHEAD) {
  const images = new Set<string>();
  const audio = new Set<string>();
  for (const { word, examples } of queue.slice(pos + 1, pos + 1 + ahead)) {
    if (word.image_key) images.add(imageUrl(word.image_key));
    if (word.audio_key) audio.add(mediaUrl(word.audio_key));
    for (const ex of examples) {
      if (ex.image_key) images.add(imageUrl(ex.image_key));
      if (ex.audio_key) audio.add(mediaUrl(ex.audio_key));
    }
  }
  return { images: [...images], audio: [...audio] };
}

const warmed = new Set<string>();

/** Fills the browser cache (media is served with immutable cache headers). Each URL is fetched once. */
export function usePreload(queue: QueueItem[], pos: number) {
  useEffect(() => {
    const { images, audio } = upcomingMedia(queue, pos);
    for (const url of images) {
      if (warmed.has(url)) continue;
      warmed.add(url);
      new Image().src = url;
    }
    for (const url of audio) {
      if (warmed.has(url)) continue;
      warmed.add(url);
      fetch(url).catch(() => warmed.delete(url));
    }
  }, [queue, pos]);
}
