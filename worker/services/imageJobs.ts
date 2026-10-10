// Drawing one claimed item: R2 first (never redraw an existing key), then the image quota,
// then flux-2-klein-4b with flux-1-schnell as fallback (SPEC F3, decided 2026-10-09).
import { IMAGE_DAILY_QUOTA, IMAGE_FAMILY_DAILY_CAP, type ImageItemKind } from "../../shared/image";
import { imageInfo } from "../lib/imageInfo";
import { consumeImageQuota } from "../lib/quota";
import { FAKE_IMAGE_KEY, FAKE_IMAGE_MODEL, fakePlaceholderBytes } from "./fakeImage";
import { IMAGE_MODELS, type AiRunner, type ImageModel } from "./imageModels";
import { withStyle } from "./imagePrompt";
import { aiImageKey, finishImage, FIRST_NONCE, IMAGE_SIZE, loadImageRow, seedFromNonce } from "./imageStore";

/** Primary model first, then the fallback. */
export const DRAW_ORDER: ImageModel[] = ["flux-2-klein-4b", "flux-1-schnell"].map(
  (label) => IMAGE_MODELS.find((m) => m.label === label)!,
);

export type ImageDeps = {
  DB: D1Database;
  bucket: R2Bucket;
  /** null when Workers AI is not available (tests, missing binding): items stay without image. */
  ai: AiRunner | null;
  /** Profile charged for the drawing (image quota). */
  profileId: string;
  now?: () => Date;
};

export type DrawResult = { status: "ready" | "failed" | "none"; quota: boolean; drawn: number };

const CONTENT_TYPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", bin: "application/octet-stream" } as const;

/**
 * Draws an item that the caller has claimed (status pending). Never throws: the outcome is
 * written to the row (ready / failed, or back to none when there is no prompt or no quota).
 */
export async function drawClaimedItem(deps: ImageDeps, kind: ImageItemKind, id: string): Promise<DrawResult> {
  const row = await loadImageRow(deps.DB, kind, id);
  if (!row) return { status: "none", quota: false, drawn: 0 };
  const nonce = row.image_nonce ?? FIRST_NONCE;
  const finish = (r: Parameters<typeof finishImage>[4]) => finishImage(deps.DB, kind, id, nonce, r);

  // Examples without an AI prompt (saved before M1.8, or typed by hand) use their English
  // translation; English sentences have none ("" = own language), so the sentence itself.
  const prompt = row.image_prompt || (kind === "example" ? row.translation_en || row.sentence : null);
  if (!prompt || !deps.ai) {
    await finish({ status: "none" });
    return { status: "none", quota: false, drawn: 0 };
  }
  // Local development (`npm run dev`): one shared placeholder, no model call, no quota.
  if (deps.ai.fake) {
    try {
      if (!(await deps.bucket.head(FAKE_IMAGE_KEY))) {
        await deps.bucket.put(FAKE_IMAGE_KEY, fakePlaceholderBytes(), { httpMetadata: { contentType: "image/png" } });
      }
      await finish({ status: "ready", key: FAKE_IMAGE_KEY, model: FAKE_IMAGE_MODEL });
      return { status: "ready", quota: false, drawn: 0 };
    } catch (err) {
      console.error(`Image ${kind} ${id} (fake) failed:`, err instanceof Error ? err.message : err);
      await finish({ status: "failed" });
      return { status: "failed", quota: false, drawn: 0 };
    }
  }
  const fullPrompt = withStyle(prompt);

  try {
    // 1) An image that already exists in R2 (same model + prompt + style + nonce) is reused for free.
    const keys = await Promise.all(DRAW_ORDER.map((m) => aiImageKey(m.id, fullPrompt, nonce)));
    for (const [i, key] of keys.entries()) {
      if (await deps.bucket.head(key)) {
        await finish({ status: "ready", key, model: DRAW_ORDER[i]!.label });
        return { status: "ready", quota: false, drawn: 0 };
      }
    }

    // 2) Draw: every real env.AI call costs one unit of the two-tier image quota.
    for (const [i, model] of DRAW_ORDER.entries()) {
      const now = deps.now?.() ?? new Date();
      if (!(await consumeImageQuota(deps.DB, deps.profileId, IMAGE_DAILY_QUOTA, IMAGE_FAMILY_DAILY_CAP, now))) {
        // No quota left: keep the emoji placeholder; it can be drawn later (Try again / backfill).
        await finish({ status: "none" });
        return { status: "none", quota: true, drawn: 0 };
      }
      try {
        const seed = model.supportsSeed ? seedFromNonce(nonce) : undefined;
        const bytes = await model.draw(deps.ai, fullPrompt, { size: IMAGE_SIZE, seed });
        const key = keys[i]!;
        await deps.bucket.put(key, bytes, { httpMetadata: { contentType: CONTENT_TYPE[imageInfo(bytes).ext] } });
        await finish({ status: "ready", key, model: model.label });
        return { status: "ready", quota: false, drawn: 1 };
      } catch (err) {
        console.error(`Image ${kind} ${id}: ${model.label} failed:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error(`Image ${kind} ${id} failed:`, err instanceof Error ? err.message : err);
  }
  await finish({ status: "failed" });
  return { status: "failed", quota: false, drawn: 0 };
}

/** Draws several claimed items in parallel (word + selected phrases right after saving). */
export async function drawClaimedItems(deps: ImageDeps, items: { kind: ImageItemKind; id: string }[]) {
  return Promise.all(items.map((it) => drawClaimedItem(deps, it.kind, it.id)));
}

/**
 * Image columns for a newly saved word / phrase: drawn right away (claimed as `pending`) when it
 * has an AI prompt and Workers AI is available; otherwise it waits (`none`) for Redraw / backfill.
 */
export function initialImageFields(prompt: string | null, imagesOn: boolean, now = new Date()) {
  const draw = imagesOn && !!prompt;
  return {
    image_prompt: prompt,
    image_status: draw ? ("pending" as const) : ("none" as const),
    image_nonce: draw ? FIRST_NONCE : null,
    image_requested_at: draw ? now : null,
  };
}
