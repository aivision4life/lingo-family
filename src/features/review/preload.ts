// Preloads the images and audio of the cards of today's session so flipping never waits (M1.9,
// extended in M2.2). The requests are plain fetches: the browser keeps them (media is served
// immutable) and the service worker stores them in its media cache for offline use.
//
//  - when the session starts: the first 30 cards, a few downloads at a time (skipped when the
//    device asks to save data);
//  - while reviewing: a window of the next 4 cards, so cards after the first 30 arrive just in time.
import { useEffect } from "react";
import type { QueueItem } from "@shared/review";
import { mediaUrl } from "@/features/audio/player";
import { imageUrl } from "@/features/images/api";

export const BULK_CARDS = 30;
export const WINDOW_CARDS = 4;
const CONCURRENCY = 3;

type Media = { images: string[]; audio: string[] };

/**
 * Media URLs of some cards: word / phrase image and audio, plus example images that are already
 * drawn and example audio. Never asks for drawing (that is ItemImage's job, and costs quota).
 */
export function mediaOf(items: QueueItem[]): Media {
  const images = new Set<string>();
  const audio = new Set<string>();
  for (const { word, examples } of items) {
    if (word.image_key) images.add(imageUrl(word.image_key));
    if (word.audio_key) audio.add(mediaUrl(word.audio_key));
    for (const ex of examples) {
      if (ex.image_key) images.add(imageUrl(ex.image_key));
      if (ex.audio_key) audio.add(mediaUrl(ex.audio_key));
    }
  }
  return { images: [...images], audio: [...audio] };
}

/** The cards after `pos` (the one on screen is already loaded). */
export const upcomingMedia = (queue: QueueItem[], pos: number, ahead = WINDOW_CARDS) => mediaOf(queue.slice(pos + 1, pos + 1 + ahead));

/** The first cards of a session: bulk preload, off when the user saves data. */
export const bulkMedia = (queue: QueueItem[], saveData: boolean): Media =>
  saveData ? { images: [], audio: [] } : mediaOf(queue.slice(0, BULK_CARDS));

/** Data Saver / "reduce data usage" is on for this device or connection. */
export const prefersSaveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

const warmed = new Set<string>();
const pending: string[] = [];
let running = 0;

async function pump() {
  while (running < CONCURRENCY && pending.length > 0) {
    const url = pending.shift()!;
    running++;
    fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .catch(() => warmed.delete(url)) // allow a retry later
      .finally(() => {
        running--;
        void pump();
      });
  }
}

/** Queues URLs (images first, then audio); each URL is fetched once, three at a time. */
export function warm({ images, audio }: Media, urgent = false) {
  const fresh = [...images, ...audio].filter((u) => !warmed.has(u));
  fresh.forEach((u) => warmed.add(u));
  if (urgent) pending.unshift(...fresh);
  else pending.push(...fresh);
  void pump();
}

export function usePreload(queue: QueueItem[], pos: number) {
  // Session start: the first 30 cards.
  useEffect(() => {
    warm(bulkMedia(queue, prefersSaveData()));
  }, [queue]);
  // Every card: the next few, in front of the bulk downloads.
  useEffect(() => {
    warm(upcomingMedia(queue, pos), true);
  }, [queue, pos]);
}
