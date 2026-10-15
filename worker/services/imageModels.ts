// FLUX text-to-image models on Workers AI (M1.8). Each model validates its input against the
// official schema before calling `env.AI` (so we never send a field the model rejects) and knows
// how many Neurons an image costs according to the published price list.
import { z } from "zod";

/** The part of the `env.AI` binding we use (model ids not yet in the generated types are allowed). */
export type AiRunner = {
  run(model: string, input: unknown): Promise<unknown>;
  /** Local-development placeholder provider (fakeImage.ts): no model call, no quota. */
  fake?: true;
};

/** `seed` is used only by models that support it (see `supportsSeed`). */
export type DrawOptions = { size: number; seed?: number };

export type ImageModel = {
  id: string;
  label: string;
  /** Without a seed, "Redraw" relies on the model's own randomness (R2 key needs a nonce). */
  supportsSeed: boolean;
  /** The input fields this model accepts (checked before every call). */
  inputSchema: z.ZodType;
  /** The fields we send for a text-to-image request (validated by `inputSchema`). */
  buildInput(prompt: string, opts: DrawOptions): Record<string, string | number>;
  /** Returns the image bytes (JPEG/PNG/WebP as the model produces them). */
  draw(ai: AiRunner, prompt: string, opts: DrawOptions): Promise<Uint8Array>;
  /** Estimated Neurons for one text-to-image call with an output of width × height. */
  neurons(width: number, height: number): number;
  /** How the estimate was computed, for reports. */
  pricing: string;
};

const outputSchema = z.object({ image: z.string().min(1) });
const tiles = (width: number, height: number) => Math.ceil(width / 512) * Math.ceil(height / 512);
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const round = (n: number) => Math.round(n * 100) / 100;
const promptField = z.string().min(1).max(2048);

const SCHNELL_ID = "@cf/black-forest-labs/flux-1-schnell";
const SCHNELL_STEPS = 4;
/** Official schema (`wrangler ai models schema`, 2026-10): prompt + steps only, no extra fields (no seed, no size). */
const schnellInput = z.strictObject({ prompt: promptField, steps: z.int().min(1).max(8).optional() });

const KLEIN_ID = "@cf/black-forest-labs/flux-2-klein-4b";
/** Multipart form fields (docs, 2026-10). steps is fixed at 4 for this distilled model. */
const kleinInput = z.strictObject({
  prompt: promptField,
  width: z.int().min(256).max(1920).optional(),
  height: z.int().min(256).max(1920).optional(),
  seed: z.int().min(0).optional(),
  guidance: z.number().optional(),
});

/** Price list checked 2026-10 (developers.cloudflare.com/workers-ai/platform/pricing). */
export const IMAGE_MODELS: ImageModel[] = [
  {
    id: SCHNELL_ID,
    label: "flux-1-schnell",
    supportsSeed: false,
    inputSchema: schnellInput,
    // No seed and no size parameter: the model picks the output size.
    buildInput: (prompt) => ({ prompt, steps: SCHNELL_STEPS }),
    async draw(ai, prompt, opts) {
      const input = schnellInput.parse(this.buildInput(prompt, opts));
      return fromBase64(outputSchema.parse(await ai.run(SCHNELL_ID, input)).image);
    },
    neurons: (w, h) => round(4.8 * tiles(w, h) + 9.6 * SCHNELL_STEPS),
    pricing: `4.80 per 512×512 output tile + 9.60 per step (${SCHNELL_STEPS} steps)`,
  },
  {
    id: KLEIN_ID,
    label: "flux-2-klein-4b",
    supportsSeed: true,
    inputSchema: kleinInput,
    buildInput: (prompt, { size, seed }) => ({ prompt, width: size, height: size, ...(seed === undefined ? {} : { seed }) }),
    // FLUX.2 models take multipart form data; a Response serializes it and gives the boundary.
    async draw(ai, prompt, opts) {
      const fields = kleinInput.parse(this.buildInput(prompt, opts));
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.append(name, String(value));
      const encoded = new Response(form);
      const out = await ai.run(KLEIN_ID, {
        multipart: { body: encoded.body, contentType: encoded.headers.get("content-type") },
      });
      return fromBase64(outputSchema.parse(out).image);
    },
    neurons: (w, h) => round(26.05 * tiles(w, h)),
    pricing: "26.05 per 512×512 output tile (+5.37 per input-image tile, none for text-to-image)",
  },
];

/** True when Workers AI says the model id does not exist (or is not available to the account). */
export const isUnknownModelError = (err: unknown) =>
  /no such model|model not found|unknown model|not a valid model|5007/i.test(err instanceof Error ? err.message : String(err));

/**
 * True when Workers AI says the account's daily free Neuron allocation (10,000/day) is used up
 * (error 4006). This is a Cloudflare account-wide limit, separate from our own `usage_daily`
 * per-profile/family image quotas; every model and every item fails the same way until it resets.
 */
export const isProviderExhaustedError = (err: unknown) =>
  /\b4006\b|daily free allocation|used up.*neurons/i.test(err instanceof Error ? err.message : String(err));
