import { describe, expect, it } from "vitest";
import { IMAGE_MODELS, isUnknownModelError, type AiRunner } from "./imageModels";
import { buildImagePromptRequest, IMAGE_STYLE, withStyle } from "./imagePrompt";

const [schnell, klein] = IMAGE_MODELS;
const PNG_B64 = btoa("\x89PNG fake");

/** Fake env.AI: records model + input, returns a base64 "image". */
const fakeAi = () => {
  const calls: { model: string; input: unknown }[] = [];
  const ai: AiRunner = {
    async run(model, input) {
      calls.push({ model, input });
      return { image: PNG_B64 };
    },
  };
  return { ai, calls };
};

describe("image models", () => {
  it("flux-1-schnell gets JSON with prompt and 4 steps only (no seed, no size)", async () => {
    const { ai, calls } = fakeAi();
    const bytes = await schnell!.draw(ai, "a red apple", { size: 512, seed: 42 });
    expect(new TextDecoder().decode(bytes)).toContain("PNG");
    expect(calls).toEqual([{ model: "@cf/black-forest-labs/flux-1-schnell", input: { prompt: "a red apple", steps: 4 } }]);
    expect(schnell!.supportsSeed).toBe(false);
  });

  it("flux-1-schnell input schema matches the official one: prompt (1-2048) + steps (≤ 8), nothing else", () => {
    const ok = (v: object) => schnell!.inputSchema.safeParse(v).success;
    expect(ok({ prompt: "x" })).toBe(true);
    expect(ok({ prompt: "x", steps: 8 })).toBe(true);
    expect(ok({ prompt: "x", seed: 42 })).toBe(false); // the 5006 error seen in the benchmark
    expect(ok({ prompt: "x", width: 512 })).toBe(false);
    expect(ok({ prompt: "x", steps: 9 })).toBe(false);
    expect(ok({ prompt: "" })).toBe(false);
    expect(ok({ prompt: "x".repeat(2049) })).toBe(false);
  });

  it("flux-2-klein-4b gets multipart form data with prompt and size (seed only when given)", async () => {
    const { ai, calls } = fakeAi();
    await klein!.draw(ai, "a red apple", { size: 512 });
    await klein!.draw(ai, "a red apple", { size: 512, seed: 7 });
    const fields = await Promise.all(
      calls.map(async ({ input }) => {
        const { multipart } = input as { multipart: { body: ReadableStream; contentType: string } };
        expect(multipart.contentType).toMatch(/^multipart\/form-data; boundary=/);
        const form = await new Response(multipart.body, { headers: { "content-type": multipart.contentType } }).formData();
        return Object.fromEntries(form);
      }),
    );
    expect(fields).toEqual([
      { prompt: "a red apple", width: "512", height: "512" },
      { prompt: "a red apple", width: "512", height: "512", seed: "7" },
    ]);
    expect(klein!.supportsSeed).toBe(true);
  });

  it("flux-2-klein-4b form schema: size 256-1920, seed and guidance allowed, steps (fixed at 4) is not", () => {
    const ok = (v: object) => klein!.inputSchema.safeParse(v).success;
    expect(ok({ prompt: "x", width: 512, height: 512, seed: 1, guidance: 2.5 })).toBe(true);
    expect(ok({ prompt: "x", width: 255 })).toBe(false);
    expect(ok({ prompt: "x", height: 1921 })).toBe(false);
    expect(ok({ prompt: "x", steps: 4 })).toBe(false);
  });

  it("invalid input is rejected before Workers AI is called", async () => {
    const { ai, calls } = fakeAi();
    await expect(klein!.draw(ai, "x", { size: 4096 })).rejects.toThrow();
    await expect(schnell!.draw(ai, "", { size: 512 })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("estimates Neurons from the price list", () => {
    expect(schnell!.neurons(512, 512)).toBe(43.2); // 4.8 × 1 tile + 9.6 × 4 steps
    expect(schnell!.neurons(1024, 1024)).toBe(57.6); // 4 tiles
    expect(klein!.neurons(512, 512)).toBe(26.05);
    expect(klein!.neurons(1024, 768)).toBe(104.2); // 2 × 2 tiles
  });

  it("rejects malformed output and recognizes unknown-model errors", async () => {
    const ai: AiRunner = { run: async () => ({ nope: true }) };
    await expect(schnell!.draw(ai, "x", { size: 512, seed: 1 })).rejects.toThrow();
    expect(isUnknownModelError(new Error("5007: No such model @cf/x"))).toBe(true);
    expect(isUnknownModelError(new Error("Capacity temporarily exceeded"))).toBe(false);
  });
});

describe("image prompts", () => {
  it("appends the fixed style once, without a double period", () => {
    expect(withStyle("A red apple on a table. ")).toBe(`A red apple on a table. ${IMAGE_STYLE}`);
  });

  it("asks for an English scene and names the item kind", () => {
    const { system, user } = buildImagePromptRequest("ko", "sentence", "고객과 회의가 있어요", "intermediate");
    expect(system).toMatch(/image_prompt/);
    expect(system).toMatch(/no style words/i);
    expect(user).toBe("Sentence (Korean): 고객과 회의가 있어요");
  });
});
