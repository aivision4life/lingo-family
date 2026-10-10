// Images of words, phrases and example sentences (SPEC F3, M1.8): API contract and limits.
import { z } from "zod";
import { imageSourceSchema, imageStatusSchema } from "./enums";

/** Daily image quota per profile, and for the whole family (sum over profiles). */
export const IMAGE_DAILY_QUOTA = 60;
export const IMAGE_FAMILY_DAILY_CAP = 150;

/** Uploads ("My photo"): resized in the browser; the Worker re-checks and never re-encodes. */
export const IMAGE_MAX_SIDE = 512;
export const IMAGE_UPLOAD_MAX_BYTES = 300 * 1024;
export const IMAGE_UPLOAD_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;

/** A pending item whose drawing was claimed longer ago than this counts as stalled. */
export const IMAGE_STALE_MS = 2 * 60 * 1000;

export const IMAGE_ITEM_KINDS = ["word", "phrase", "example"] as const;
export const imageItemKindSchema = z.enum(IMAGE_ITEM_KINDS);
export type ImageItemKind = z.infer<typeof imageItemKindSchema>;

/** `image_prompt` as stored / edited ("Redraw" dialog). The style is appended by the server. */
export const imagePromptTextSchema = z.string().trim().min(3).max(400);

/** Image fields sent with every word, phrase and example. Show via `/api/media/{image_key}`. */
export const imageViewSchema = z.object({
  image_key: z.string().nullable(),
  image_status: imageStatusSchema,
  image_prompt: z.string().nullable(),
  image_source: imageSourceSchema.nullable(),
  /** When drawing was claimed (epoch ms); lets the client spot a stalled `pending` item. */
  image_requested_at: z.number().nullable(),
});
export type ImageView = z.infer<typeof imageViewSchema>;

/** POST /api/images/:kind/:id/{ensure,retry} and /api/images/backfill */
export const imageProfileRequestSchema = z.object({ profile_id: z.string().min(1) });
/** POST /api/images/:kind/:id/redraw — the (edited) scene description; a new nonce is used. */
export const redrawRequestSchema = z.object({ profile_id: z.string().min(1), image_prompt: imagePromptTextSchema });

/** State of one item after an image request. `quota` = not drawn because a daily limit was reached. */
export const imageStateSchema = imageViewSchema.extend({ quota: z.boolean() });
export type ImageState = z.infer<typeof imageStateSchema>;

/** POST /api/images/backfill — one old word per call (its image prompts + word/phrase images). */
export const backfillResponseSchema = z.object({
  /** Word handled by this call, or null when nothing is left. */
  word: z.object({ id: z.string(), term: z.string() }).nullable(),
  /** Images drawn in this call. */
  drawn: z.number().int().nonnegative(),
  /** Words / phrases still without an image (after this call). */
  remaining: z.number().int().nonnegative(),
  /** Stopped because a daily image or LLM limit was reached. */
  quota: z.boolean(),
});
export type BackfillResponse = z.infer<typeof backfillResponseSchema>;

/** GET /api/usage?profile_id= — today's quota use (UTC day). */
export const usageSchema = z.object({
  date: z.string(),
  family: z.object({ image: z.number(), image_cap: z.number() }),
  profile: z.object({
    image: z.number(),
    image_limit: z.number(),
    llm: z.number(),
    llm_limit: z.number(),
    tts: z.number(),
    tts_limit: z.number(),
  }),
  /** Model that answered the most recent (uncached) LLM call; null before the first call. */
  llm_last: z.object({ model: z.string(), fallback: z.boolean(), at: z.number() }).nullable(),
});
export type Usage = z.infer<typeof usageSchema>;

/** GET /api/images/backfill/status */
export const backfillStatusSchema = z.object({ remaining: z.number().int().nonnegative() });

export const IMAGE_ERRORS = {
  /** Workers AI is not available (no AI binding). */
  notConfigured: "image_not_configured",
  /** Upload is not a WebP/JPEG/PNG of at most 512 px and 300 KB. */
  invalidUpload: "invalid_image",
} as const;
