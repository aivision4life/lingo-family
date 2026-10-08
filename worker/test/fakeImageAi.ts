import type { AiRunner } from "../services/imageModels";

/** A tiny "JPEG" (SOI + SOF0 of 512×512) that imageInfo recognizes. */
export const FAKE_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 2, 0, 2, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
const b64 = btoa(String.fromCharCode(...FAKE_JPEG));

type Behaviour = "ok" | "error";

/**
 * Fake `env.AI`: records each call's model; `behaviour[modelId]` decides success or an error.
 * `gate` (optional) is awaited before answering, to hold a drawing "in flight" in tests.
 */
export function fakeImageAi(behaviour: Record<string, Behaviour> = {}) {
  const calls: string[] = [];
  const state = { behaviour, gate: null as Promise<void> | null };
  const ai: AiRunner = {
    async run(model) {
      calls.push(model);
      if (state.gate) await state.gate;
      if ((state.behaviour[model] ?? "ok") === "error") throw new Error(`3040: ${model} capacity exceeded`);
      return { image: b64 };
    },
  };
  return { ai, calls, state };
}
