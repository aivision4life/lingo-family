import { Hono } from "hono";
import type { AppEnv } from "../env";
import { IMAGE_KEY_PATTERN } from "../services/imageStore";
import { AUDIO_KEY_PATTERN } from "../services/tts";

/**
 * GET /api/media/audio/... and /api/media/images/... — serves content-addressed files from R2.
 * A key's content never changes, so browsers may cache it forever.
 */
async function serve(bucket: R2Bucket, key: string, fallbackType: string) {
  const object = await bucket.get(key);
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? fallbackType,
      "Content-Length": String(object.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
}

const keyAfter = (path: string, prefix: string) => decodeURIComponent(path.slice(path.indexOf(`/${prefix}/`) + 1));

export const mediaRoutes = new Hono<AppEnv>()
  .get("/audio/*", async (c) => {
    const key = keyAfter(c.req.path, "audio");
    if (!AUDIO_KEY_PATTERN.test(key)) return c.json({ error: "not_found" }, 404);
    return (await serve(c.env.MEDIA, key, "audio/mpeg")) ?? c.json({ error: "not_found" }, 404);
  })
  /** GET /api/media/images/{ai|upload}/<sha1>.<ext> (SPEC F3). */
  .get("/images/*", async (c) => {
    const key = keyAfter(c.req.path, "images");
    if (!IMAGE_KEY_PATTERN.test(key)) return c.json({ error: "not_found" }, 404);
    return (await serve(c.env.MEDIA, key, "image/jpeg")) ?? c.json({ error: "not_found" }, 404);
  });
