/**
 * Where a TOPIK listening paper's audio lives (M7.1). One mp3 per exam, never cut into clips: a
 * segment is a pair of timestamps into this file, so re-cutting a segment is a DB edit and the
 * audio is uploaded exactly once.
 *
 * Content-addressed like images: the key is the sha1 of the file's bytes, so re-uploading the same
 * paper costs no extra storage and a key's content never changes (hence the immutable caching in
 * the media route).
 */
export const TOPIK_AUDIO_KEY_PATTERN = /^topik\/audio\/[0-9a-f]{40}\.mp3$/;

export const topikAudioKey = (sha1: string) => `topik/audio/${sha1}.mp3`;

/** Hex sha1 of the file's bytes, the same scheme `imageUpload.ts` uses for photos. */
export async function sha1Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
