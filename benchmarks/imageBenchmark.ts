// M1.8A image benchmark: 5 sample items × FLUX models on Workers AI.
// Run with `npm run bench:images` (needs `npx wrangler login` once, and LLM_API_KEY in .dev.vars).
// Prompts and images are kept in benchmarks/; a re-run only draws what is missing (`--redraw` forces it).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import type { ExampleLevel, LearnLang } from "../shared/enums";
import { IMAGE_MODELS, isUnknownModelError, type AiRunner } from "../worker/services/imageModels";
import { buildImagePromptRequest, IMAGE_STYLE, IMAGE_STYLE_VERSION, imagePromptSchema, withStyle, type ImageItemKind } from "../worker/services/imagePrompt";
import { createLlmClient, generateStructured } from "../worker/services/llm";
import { imageInfo } from "../worker/lib/imageInfo";
import { DASHBOARD_GUIDE, renderReport, type BenchResults, type Cell } from "./report";

const DIR = path.resolve("benchmarks");
const IMAGES = path.join(DIR, "images");
const RESULTS = path.join(DIR, "results.json");
const SIZE = 512;

type Item = { id: string; kind: ImageItemKind; lang: LearnLang; level: ExampleLevel; text: string; note: string };
const ITEMS: Item[] = [
  { id: "1-sagwa", kind: "word", lang: "ko", level: "beginner", text: "사과", note: "concrete noun" },
  { id: "2-huimang", kind: "word", lang: "ko", level: "beginner", text: "희망", note: "abstract word" },
  { id: "3-hoeui", kind: "phrase", lang: "ko", level: "intermediate", text: "회의를 하다", note: "phrase" },
  { id: "4-meeting", kind: "sentence", lang: "ko", level: "intermediate", text: "저는 오후 3시에 고객과 회의가 있어요", note: "sentence, office" },
  { id: "5-goyangi", kind: "word", lang: "ko", level: "kid", text: "고양이", note: "word for kids" },
];

type BenchEnv = { AI?: AiRunner; LLM_PROVIDER?: string; LLM_MODEL?: string; LLM_FALLBACK_MODEL?: string; LLM_API_KEY?: string };

const loadPrevious = (): BenchResults | null => (existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, "utf8")) as BenchResults) : null);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

async function main() {
  const redraw = process.argv.includes("--redraw");
  mkdirSync(IMAGES, { recursive: true });
  const previous = loadPrevious();

  console.log("Connecting to Workers AI (remote binding)…");
  const proxy = await getPlatformProxy<BenchEnv>({ persist: false, remoteBindings: true });
  try {
    const env = proxy.env;
    if (!env.AI) throw new Error('No AI binding: add "ai": { "binding": "AI" } to wrangler.jsonc.');
    const llm = createLlmClient(env);

    const results: BenchResults = {
      generated_at: new Date().toISOString(),
      llm_model: llm?.model ?? previous?.llm_model ?? "",
      llm_fallback_model: env.LLM_FALLBACK_MODEL || previous?.llm_fallback_model || null,
      style: IMAGE_STYLE,
      style_version: IMAGE_STYLE_VERSION,
      size: SIZE,
      // No seed: flux-1-schnell has none, and both models are compared the same way.
      seed: null,
      models: IMAGE_MODELS.map((m) => ({ label: m.label, id: m.id, pricing: m.pricing })),
      items: [],
      cells: {},
    };

    // 1) image_prompt per item from Gemini (reused from the previous run when the text is unchanged).
    // The shared client retries busy errors and may use LLM_FALLBACK_MODEL; a failed item is skipped.
    for (const item of ITEMS) {
      const old = previous?.items.find((p) => p.id === item.id && p.text === item.text && p.kind === item.kind && p.image_prompt);
      let imagePrompt = old?.image_prompt ?? "";
      let promptModel = old?.prompt_model ?? previous?.llm_model ?? "";
      let promptError: string | undefined;
      if (!imagePrompt) {
        if (!llm) throw new Error("LLM_API_KEY is missing in .dev.vars (needed to write image prompts).");
        const req = buildImagePromptRequest(item.lang, item.kind, item.text, item.level);
        try {
          const res = await generateStructured(llm, imagePromptSchema, req);
          imagePrompt = res.data.image_prompt;
          promptModel = res.model;
        } catch (err) {
          promptError = message(err);
        }
      }
      results.items.push({
        ...item, image_prompt: imagePrompt, full_prompt: imagePrompt ? withStyle(imagePrompt) : "", prompt_model: promptModel,
        ...(promptError ? { prompt_error: promptError } : {}),
      });
      console.log(`prompt ${item.id}: ${imagePrompt || `FAILED (${promptError})`}${promptModel ? ` [${promptModel}]` : ""}`);
    }

    // 2) Draw every item with every model.
    for (const model of IMAGE_MODELS) {
      let unavailable: string | null = null;
      for (const item of results.items) {
        const cells = (results.cells[item.id] ??= {});
        const old = previous?.cells[item.id]?.[model.label];
        const reusable =
          !redraw && old?.status === "ok" && old.full_prompt === item.full_prompt && existsSync(path.join(DIR, old.file!));
        if (reusable) {
          cells[model.label] = old;
          continue;
        }
        if (!item.full_prompt) {
          cells[model.label] = { status: "skipped", error: "no image_prompt (Gemini failed); run again later" };
          continue;
        }
        if (unavailable) {
          cells[model.label] = { status: "skipped", error: unavailable };
          continue;
        }
        cells[model.label] = await drawOne(env.AI, model, item.id, item.full_prompt);
        const cell = cells[model.label]!;
        if (cell.status === "skipped") unavailable = cell.error ?? "model not available";
        console.log(`${model.label} ${item.id}: ${cell.status}${cell.ms ? ` ${cell.ms} ms` : ""}${cell.error ? ` (${cell.error})` : ""}`);
      }
    }

    writeFileSync(RESULTS, JSON.stringify(results, null, 2) + "\n");
    writeFileSync(path.join(DIR, "report.html"), renderReport(results));
    console.log(`\nReport: ${path.join(DIR, "report.html")}\n`);
    console.log(DASHBOARD_GUIDE);
  } finally {
    await proxy.dispose();
  }
}

async function drawOne(ai: AiRunner, model: (typeof IMAGE_MODELS)[number], itemId: string, prompt: string): Promise<Cell> {
  const started = performance.now();
  try {
    const bytes = await model.draw(ai, prompt, { size: SIZE });
    const ms = Math.round(performance.now() - started);
    const info = imageInfo(bytes);
    const file = `images/${itemId}__${model.label}.${info.ext}`;
    writeFileSync(path.join(DIR, file), bytes);
    return {
      status: "ok", file, ms, bytes: bytes.length, width: info.width, height: info.height,
      neurons: model.neurons(info.width || SIZE, info.height || SIZE), full_prompt: prompt,
    };
  } catch (err) {
    if (isUnknownModelError(err)) return { status: "skipped", error: `model not available: ${message(err)}` };
    return { status: "error", error: message(err), ms: Math.round(performance.now() - started) };
  }
}

main().catch((err: unknown) => {
  console.error(`\nBenchmark failed: ${message(err)}`);
  if (/auth|login|token|10000|unauthori[sz]ed/i.test(message(err))) console.error("Run `npx wrangler login` first, then try again.");
  process.exitCode = 1;
});
