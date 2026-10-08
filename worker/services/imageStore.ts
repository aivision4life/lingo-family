// Image state in D1 (words / phrases / examples share the same image_* columns) and R2 keys.
// Claiming uses conditional UPDATEs: only the request that changes the row (changes = 1)
// may call Workers AI, so two requests never draw the same item twice.
import { IMAGE_STALE_MS, type ImageItemKind, type ImageView } from "../../shared/image";
import type { ImageSource, ImageStatus } from "../../shared/enums";
import { sha1Hex } from "../lib/hash";
import { IMAGE_STYLE_VERSION } from "./imagePrompt";

/** Fixed table names (never user input). */
export const IMAGE_TABLE: Record<ImageItemKind, string> = { word: "words", phrase: "phrases", example: "examples" };

/** Output size requested from the model (flux-1-schnell ignores it and draws 1024×1024). */
export const IMAGE_SIZE = 512;

/** First drawing: nonce "0". Every Redraw: a new random nonce (used as the seed when the model has one). */
export const FIRST_NONCE = "0";
export const newNonce = () => String(crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff);
export const seedFromNonce = (nonce: string) => Number(nonce) || 0;

/** Content-addressed key: images/ai/sha1(model + full prompt + style version + nonce + size).jpg */
export async function aiImageKey(model: string, fullPrompt: string, nonce: string, size = IMAGE_SIZE) {
  return `images/ai/${await sha1Hex(JSON.stringify([model, fullPrompt, IMAGE_STYLE_VERSION, nonce, size]))}.jpg`;
}

/** Validates keys requested through /api/media/images/... */
export const IMAGE_KEY_PATTERN = /^images\/(ai|upload)\/[0-9a-f]{40}\.(jpg|png|webp)$/;

/** Row fields needed to build the view and to draw. */
export type ImageRow = {
  image_key: string | null;
  image_status: ImageStatus;
  image_prompt: string | null;
  image_source: ImageSource | null;
  image_nonce: string | null;
  image_requested_at: Date | number | null;
};

const ms = (d: Date | number | null) => (d === null ? null : typeof d === "number" ? d : d.getTime());

/** The image fields sent to the client. */
export const imageView = (r: ImageRow): ImageView => ({
  image_key: r.image_key,
  image_status: r.image_status,
  image_prompt: r.image_prompt,
  image_source: r.image_source,
  image_requested_at: ms(r.image_requested_at),
});

/**
 * Which rows a claim may take:
 * - stale    = pending, but claimed more than IMAGE_STALE_MS ago (the Worker was cut off).
 * - ensure   = lazy example images (status none) or any stalled item; anyone may trigger it.
 * - retry    = failed / not drawn yet (quota, old item) / stalled; adults only.
 * - redraw   = anything except an item another request is drawing right now; adults only.
 * - backfill = old items never requested (status none) or stalled.
 */
export type ClaimMode = "ensure" | "retry" | "redraw" | "backfill";

function claimCondition(kind: ImageItemKind, mode: ClaimMode) {
  const stale = "(image_status = 'pending' AND (image_requested_at IS NULL OR image_requested_at < ?5))";
  switch (mode) {
    case "ensure":
      return kind === "example" ? `(image_status = 'none' OR ${stale})` : stale;
    case "retry":
      return `(image_status IN ('failed', 'none') OR ${stale})`;
    case "redraw":
      return `NOT (image_status = 'pending' AND image_requested_at >= ?5)`;
    case "backfill":
      return `(image_status = 'none' OR ${stale})`;
  }
}

/**
 * Marks the item `pending` if `mode` allows it. Returns true only for the request whose UPDATE
 * changed the row — that request (alone) draws. `nonce` / `prompt` replace the stored ones (Redraw).
 */
export async function claimImage(
  DB: D1Database,
  kind: ImageItemKind,
  id: string,
  mode: ClaimMode,
  opts: { now?: number; nonce?: string; prompt?: string } = {},
): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const res = await DB.prepare(
    `UPDATE ${IMAGE_TABLE[kind]}
        SET image_status = 'pending', image_requested_at = ?1,
            image_nonce = coalesce(?2, image_nonce, '${FIRST_NONCE}'), image_prompt = coalesce(?3, image_prompt)
      WHERE id = ?4 AND ${claimCondition(kind, mode)}`,
  )
    .bind(now, opts.nonce ?? null, opts.prompt ?? null, id, now - IMAGE_STALE_MS)
    .run();
  return res.meta.changes === 1;
}

/**
 * Stores the result of a drawing, but only if the item still has the nonce this job drew for
 * (a newer Redraw or upload wins). A failed / skipped job keeps the previous image_key.
 */
export async function finishImage(
  DB: D1Database,
  kind: ImageItemKind,
  id: string,
  nonce: string,
  result: { status: "ready"; key: string; model: string } | { status: "failed" | "none" },
) {
  const ready = result.status === "ready";
  await DB.prepare(
    `UPDATE ${IMAGE_TABLE[kind]}
        SET image_status = ?1,
            image_key = coalesce(?2, image_key),
            image_source = CASE WHEN ?2 IS NULL THEN image_source ELSE 'ai' END,
            image_model = CASE WHEN ?2 IS NULL THEN image_model ELSE ?3 END
      WHERE id = ?4 AND image_nonce = ?5`,
  )
    .bind(result.status, ready ? result.key : null, ready ? result.model : null, id, nonce)
    .run();
}

/** Loads the image fields of one item (+ the sentence and its English translation for an example). */
export async function loadImageRow(DB: D1Database, kind: ImageItemKind, id: string) {
  const extra = kind === "example" ? ", translation_en, sentence" : ", NULL AS translation_en, NULL AS sentence";
  return DB.prepare(
    `SELECT image_key, image_status, image_prompt, image_source, image_nonce, image_requested_at${extra}
       FROM ${IMAGE_TABLE[kind]} WHERE id = ?1`,
  )
    .bind(id)
    .first<ImageRow & { translation_en: string | null; sentence: string | null }>();
}
