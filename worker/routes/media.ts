import { Hono } from "hono";
import type { AppEnv } from "../env";
import { AUDIO_KEY_PATTERN } from "../services/tts";

/**
 * GET /api/media/audio/... — serves content-addressed files from R2.
 * A key's content never changes, so browsers may cache it forever.
 */
export const mediaRoutes = new Hono<AppEnv>().get("/audio/*", async (c) => {
  const key = decodeURIComponent(c.req.path.slice(c.req.path.indexOf("/audio/") + 1));
  if (!AUDIO_KEY_PATTERN.test(key)) return c.json({ error: "not_found" }, 404);

  const object = await c.env.MEDIA.get(key);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "audio/mpeg",
      "Content-Length": String(object.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
});
