// /api/images/... (draw, redraw, retry, upload, backfill) and /api/usage (SPEC F3, M1.8).
// Drawing here runs inside the request (the client waits), so the 30 s waitUntil limit does not apply.
import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  backfillResponseSchema,
  IMAGE_DAILY_QUOTA,
  IMAGE_ERRORS,
  IMAGE_FAMILY_DAILY_CAP,
  IMAGE_MAX_SIDE,
  IMAGE_UPLOAD_MAX_BYTES,
  IMAGE_UPLOAD_TYPES,
  imageItemKindSchema,
  imageProfileRequestSchema,
  redrawRequestSchema,
  type ImageItemKind,
  type ImageState,
  type Usage,
} from "../../shared/image";
import { LLM_DAILY_QUOTA, TTS_DAILY_QUOTA, WORD_ERRORS } from "../../shared/word";
import { profiles } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";
import { runAiTask } from "../lib/aiTask";
import { imageInfo } from "../lib/imageInfo";
import { usageDate } from "../lib/quota";
import { DEFAULT_GEMINI_MODEL } from "../services/llm";
import { zv } from "../lib/validate";
import { backfillRemaining, drawWordBackfill, fillImagePrompts, nextBackfillWord } from "../services/imageBackfill";
import { drawClaimedItem, type DrawResult, type ImageDeps } from "../services/imageJobs";
import { claimImage, IMAGE_TABLE, imageView, loadImageRow, newNonce, type ClaimMode } from "../services/imageStore";
import type { ContentDeps } from "./words";

const itemParam = zv("param", z.object({ kind: imageItemKindSchema, id: z.string().min(1) }));
const profileBody = zv("json", imageProfileRequestSchema);

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function state(DB: D1Database, kind: ImageItemKind, id: string, quota = false): Promise<ImageState | null> {
  const row = await loadImageRow(DB, kind, id);
  return row ? { ...imageView(row), quota } : null;
}

export const imageRoutes = ({ makeLlm, makeImageAi }: ContentDeps) => {
  const deps = (c: Context<AppEnv>, profileId: string): ImageDeps => ({
    DB: c.env.DB,
    bucket: c.env.MEDIA,
    ai: makeImageAi(c.env, c.req.url),
    profileId,
  });

  /** Claims the item with `mode`; only the request that won the claim draws (others just read the state). */
  async function claimAndDraw(c: Context<AppEnv>, kind: ImageItemKind, id: string, profileId: string, mode: ClaimMode, opts = {}) {
    let result: DrawResult | null = null;
    if (await claimImage(c.env.DB, kind, id, mode, opts)) result = await drawClaimedItem(deps(c, profileId), kind, id);
    const s = await state(c.env.DB, kind, id, result?.quota ?? false);
    return s ? c.json(s) : c.json({ error: "not_found" }, 404);
  }

  return (
    new Hono<AppEnv>()
      /** Lazy example images (any profile, also kids) and take-over of stalled drawings. */
      .post("/images/:kind/:id/ensure", itemParam, profileBody, async (c) => {
        const { kind, id } = c.req.valid("param");
        const { profile_id } = c.req.valid("json");
        const p = await getDb(c.env).select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profile_id)).get();
        if (!p) return c.json({ error: "not_found" }, 404);
        if (!makeImageAi(c.env, c.req.url)) {
          const s = await state(c.env.DB, kind, id);
          return s ? c.json(s) : c.json({ error: "not_found" }, 404);
        }
        return claimAndDraw(c, kind, id, profile_id, "ensure");
      })

      /** "Try again" for a failed (or never drawn) image, same prompt and nonce. Adults only. */
      .post("/images/:kind/:id/retry", itemParam, profileBody, async (c) => {
        const { kind, id } = c.req.valid("param");
        const { profile_id } = c.req.valid("json");
        const denied = await requireAdult(c, profile_id);
        if (denied) return denied;
        if (!makeImageAi(c.env, c.req.url)) return c.json({ error: IMAGE_ERRORS.notConfigured }, 503);
        return claimAndDraw(c, kind, id, profile_id, "retry");
      })

      /** "Redraw" with an edited prompt and a new nonce (new R2 key; the old image is kept). Adults only. */
      .post("/images/:kind/:id/redraw", itemParam, zv("json", redrawRequestSchema), async (c) => {
        const { kind, id } = c.req.valid("param");
        const { profile_id, image_prompt } = c.req.valid("json");
        const denied = await requireAdult(c, profile_id);
        if (denied) return denied;
        if (!makeImageAi(c.env, c.req.url)) return c.json({ error: IMAGE_ERRORS.notConfigured }, 503);
        return claimAndDraw(c, kind, id, profile_id, "redraw", { nonce: newNonce(), prompt: image_prompt });
      })

      /** "My photo": a WebP/JPEG/PNG already resized in the browser (≤ 512 px, ≤ 300 KB). Adults only. */
      .post("/images/:kind/:id/upload", itemParam, zv("query", imageProfileRequestSchema), async (c) => {
        const { kind, id } = c.req.valid("param");
        const { profile_id } = c.req.valid("query");
        const denied = await requireAdult(c, profile_id);
        if (denied) return denied;
        if (!(await loadImageRow(c.env.DB, kind, id))) return c.json({ error: "not_found" }, 404);

        const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        const info = imageInfo(bytes);
        const expected = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[type];
        const ok =
          (IMAGE_UPLOAD_TYPES as readonly string[]).includes(type) &&
          bytes.length > 0 && bytes.length <= IMAGE_UPLOAD_MAX_BYTES &&
          info.ext === expected && info.width > 0 && info.height > 0 &&
          info.width <= IMAGE_MAX_SIDE && info.height <= IMAGE_MAX_SIDE;
        if (!ok) return c.json({ error: IMAGE_ERRORS.invalidUpload }, 400);

        const key = `images/upload/${hex(await crypto.subtle.digest("SHA-1", bytes))}.${info.ext}`;
        if (!(await c.env.MEDIA.head(key))) await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
        // A new nonce also stops an AI drawing still in flight from replacing the photo.
        await c.env.DB.prepare(
          `UPDATE ${IMAGE_TABLE[kind]} SET image_key = ?1, image_status = 'ready', image_source = 'upload',
             image_model = NULL, image_nonce = ?2, image_requested_at = NULL WHERE id = ?3`,
        )
          .bind(key, newNonce(), id)
          .run();
        return c.json(await state(c.env.DB, kind, id));
      })

      /** "Create images for old words": one word per call; the client calls again until done. */
      .post("/images/backfill", profileBody, async (c) => {
        const db = getDb(c.env);
        const { profile_id } = c.req.valid("json");
        const denied = await requireAdult(c, profile_id);
        if (denied) return denied;
        if (!makeImageAi(c.env, c.req.url)) return c.json({ error: IMAGE_ERRORS.notConfigured }, 503);

        const word = await nextBackfillWord(db);
        if (!word) return c.json(backfillResponseSchema.parse({ word: null, drawn: 0, remaining: 0, quota: false }));

        const llm = makeLlm(c.env);
        if (!llm) return c.json({ error: WORD_ERRORS.aiNotConfigured }, 503);
        const prompts = await runAiTask(c, profile_id, (beforeLlmCall) => fillImagePrompts(db, llm, word, beforeLlmCall));
        if (!prompts.ok) {
          if (prompts.response.status === 429) {
            return c.json({ word: { id: word.id, term: word.term }, drawn: 0, remaining: await backfillRemaining(c.env.DB), quota: true });
          }
          return prompts.response;
        }

        const { drawn, quota } = await drawWordBackfill(db, deps(c, profile_id), word.id);
        return c.json({ word: { id: word.id, term: word.term }, drawn, remaining: await backfillRemaining(c.env.DB), quota });
      })

      .get("/images/backfill/status", async (c) => c.json({ remaining: await backfillRemaining(c.env.DB) }))

      /** Today's quota use (UTC day): images for the family and the profile, plus LLM and TTS. */
      .get("/usage", zv("query", imageProfileRequestSchema), async (c) => {
        const { profile_id } = c.req.valid("query");
        const date = usageDate();
        const rows = await c.env.DB.prepare("SELECT profile_id, service, count FROM usage_daily WHERE date = ?1")
          .bind(date)
          .all<{ profile_id: string; service: string; count: number }>();
        const mine = (service: string) =>
          rows.results.find((r) => r.profile_id === profile_id && r.service === service)?.count ?? 0;
        // ai_cache.model = model that answered (primary or LLM_FALLBACK_MODEL); cache hits add no row.
        const last = await c.env.DB.prepare("SELECT model, created_at FROM ai_cache WHERE model IS NOT NULL ORDER BY created_at DESC LIMIT 1").first<{
          model: string;
          created_at: number;
        }>();
        const primary = c.env.LLM_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
        const usage: Usage = {
          date,
          family: {
            image: rows.results.filter((r) => r.service === "image").reduce((n, r) => n + r.count, 0),
            image_cap: IMAGE_FAMILY_DAILY_CAP,
          },
          profile: {
            image: mine("image"),
            image_limit: IMAGE_DAILY_QUOTA,
            llm: mine("llm"),
            llm_limit: LLM_DAILY_QUOTA,
            tts: mine("tts"),
            tts_limit: TTS_DAILY_QUOTA,
          },
          llm_last: last ? { model: last.model, fallback: last.model !== primary, at: last.created_at } : null,
        };
        return c.json(usage);
      })
  );
};
