import { Hono } from "hono";
import type { AppEnv } from "../env";
import { contentRange, parseByteRange } from "../lib/range";
import { IMAGE_KEY_PATTERN } from "../services/imageStore";
import { TOPIK_AUDIO_KEY_PATTERN } from "../services/topikAudioStore";
import { AUDIO_KEY_PATTERN } from "../services/tts";

/**
 * GET /api/media/audio/... , /api/media/images/... and /api/media/topik/... — serves
 * content-addressed files from R2. A key's content never changes, so browsers may cache it forever.
 *
 * Range requests are honoured (M7.1): a TOPIK listening exam is one ~30 MB mp3 and practice plays a
 * 30-second clip from the middle of it, so without ranges the browser would fetch the whole paper
 * before the first sound. R2 does the slicing server-side — only the asked-for bytes leave the
 * bucket. `<audio>` on iOS always asks for ranges, so this path matters for every sound in the app.
 */
async function serve(bucket: R2Bucket, key: string, fallbackType: string, rangeHeader: string | null) {
  // A HEAD first would cost an extra round trip, so the size comes from a ranged get's own metadata:
  // fetch without a range when there is none, and let R2 resolve the range when there is.
  const head = rangeHeader ? await bucket.head(key) : null;
  if (rangeHeader && !head) return null;

  const range = head ? parseByteRange(rangeHeader, head.size) : null;
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${head!.size}`, "Accept-Ranges": "bytes" } });
  }

  const object = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!object) return null;

  const size = head?.size ?? object.size;
  const headers: Record<string, string> = {
    "Content-Type": object.httpMetadata?.contentType ?? fallbackType,
    "Content-Length": String(range ? range.length : size),
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    ETag: object.httpEtag,
  };
  if (range) headers["Content-Range"] = contentRange(range, size);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

const keyAfter = (path: string, prefix: string) => decodeURIComponent(path.slice(path.indexOf(`/${prefix}/`) + 1));

export const mediaRoutes = new Hono<AppEnv>()
  .get("/audio/*", async (c) => {
    const key = keyAfter(c.req.path, "audio");
    if (!AUDIO_KEY_PATTERN.test(key)) return c.json({ error: "not_found" }, 404);
    return (await serve(c.env.MEDIA, key, "audio/mpeg", c.req.header("Range") ?? null)) ?? c.json({ error: "not_found" }, 404);
  })
  /** GET /api/media/images/{ai|upload}/<sha1>.<ext> (SPEC F3). */
  .get("/images/*", async (c) => {
    const key = keyAfter(c.req.path, "images");
    if (!IMAGE_KEY_PATTERN.test(key)) return c.json({ error: "not_found" }, 404);
    return (await serve(c.env.MEDIA, key, "image/jpeg", c.req.header("Range") ?? null)) ?? c.json({ error: "not_found" }, 404);
  })
  /** GET /api/media/topik/audio/<sha1>.mp3 — one whole TOPIK listening paper (M7.1). */
  .get("/topik/*", async (c) => {
    const key = keyAfter(c.req.path, "topik");
    if (!TOPIK_AUDIO_KEY_PATTERN.test(key)) return c.json({ error: "not_found" }, 404);
    return (await serve(c.env.MEDIA, key, "audio/mpeg", c.req.header("Range") ?? null)) ?? c.json({ error: "not_found" }, 404);
  });
