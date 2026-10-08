import { describe, expect, it } from "vitest";
import { imageInfo } from "../worker/lib/imageInfo";
import { renderReport, type BenchResults } from "./report";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("imageInfo", () => {
  it("reads PNG, JPEG and WebP (VP8X) sizes", () => {
    const png = bytes([0x89], "PNG", [13, 10, 26, 10, 0, 0, 0, 13], "IHDR", [0, 0, 2, 0, 0, 0, 1, 0]);
    expect(imageInfo(png)).toEqual({ ext: "png", width: 512, height: 256 });

    // SOI, APP0 (length 4), SOF0: length, precision, height 768, width 1024.
    const jpg = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 3, 0, 4, 0, 0, 0, 0]);
    expect(imageInfo(jpg)).toEqual({ ext: "jpg", width: 1024, height: 768 });

    const webp = bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0, 0, 0, 0, 0], [0xff, 1, 0], [0xff, 1, 0]);
    expect(imageInfo(webp)).toEqual({ ext: "webp", width: 512, height: 512 });
  });
});

describe("renderReport", () => {
  it("renders one row per item, one column per model and escapes text", () => {
    const r: BenchResults = {
      generated_at: "2026-10-08T00:00:00Z", llm_model: "gemini", style: "flat", style_version: "style-v1", size: 512, seed: null,
      models: [{ label: "m1", id: "@cf/m1", pricing: "p" }, { label: "m2", id: "@cf/m2", pricing: "p" }],
      llm_fallback_model: "lite",
      items: [
        { id: "a", kind: "word", lang: "ko", level: "kid", text: "고양이", note: "n", image_prompt: "a <cat>", full_prompt: "a <cat>. flat", prompt_model: "lite" },
        { id: "b", kind: "word", lang: "ko", level: "kid", text: "개", note: "n", image_prompt: "a dog", full_prompt: "a dog. flat", prompt_model: "gemini" },
      ],
      cells: { a: { m1: { status: "ok", file: "images/a__m1.jpg", ms: 1500, bytes: 40960, width: 512, height: 512, neurons: 43.2 }, m2: { status: "skipped", error: "model not available" } } },
    };
    const html = renderReport(r);
    expect(html).toContain('<img src="images/a__m1.jpg"');
    expect(html).toContain("a &#60;cat&#62;");
    expect(html).toContain("≈ 43.2 Neurons");
    expect(html).toContain("model not available");
    expect(html).toContain("≈ 231"); // 10,000 / 43.2 images per day
    // Prompts written by the fallback model are flagged, per item and in the summary.
    expect(html).toContain("fallback model</span> prompt by lite (gemini was busy)");
    expect(html).toContain("1 by gemini (primary)");
    expect(html).toContain("1 by the fallback model lite");
    expect(html).toContain("no seed");
  });
});
