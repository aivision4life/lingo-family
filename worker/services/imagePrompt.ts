// Image prompts for FLUX (M1.8). Gemini writes a short English scene description
// (`image_prompt`); the server appends the fixed style. The LLM never writes the style.
import { z } from "zod";
import type { ExampleLevel, LearnLang } from "../../shared/enums";

/** Part of every AI image key: changing IMAGE_STYLE means bumping this, never silently redrawing. */
export const IMAGE_STYLE_VERSION = "style-v1";
export const IMAGE_STYLE =
  "flat vector illustration, bright colors, simple shapes, plain background, no text, no letters, family-friendly, safe for children";

/** Rules for `image_prompt`, shared by the enrichment prompt (M1.8B) and stand-alone requests. */
export const IMAGE_PROMPT_RULES = [
  "image_prompt: one short English description (10-40 words) of a single concrete scene that pictures the meaning.",
  "Describe visible objects, people, animals and actions only; no style words (the drawing style is added later).",
  "Abstract words are shown through a typical situation (e.g. 'promise' → two children hooking little fingers).",
  "Sentences: show the situation the sentence describes, with the main people and objects.",
  "Never ask for text, letters, numbers, signs, speech bubbles or logos in the picture; show time with a clock face if needed.",
  "Keep it family-friendly and safe for children.",
].join("\n");

const LEVEL_HINT: Record<ExampleLevel, string> = {
  kid: "The learner is a young child: one or two big, cute, simple objects.",
  beginner: "Keep the scene simple, with few objects.",
  intermediate: "Everyday adult or office scenes are welcome; keep the scene simple.",
};

export type ImageItemKind = "word" | "phrase" | "sentence" | "example";

export const imagePromptSchema = z.object({ image_prompt: z.string().trim().min(10).max(400) });

/** Stand-alone request: one item → `{ image_prompt }` (used by the benchmark and for old items). */
export function buildImagePromptRequest(lang: LearnLang, kind: ImageItemKind, text: string, level: ExampleLevel) {
  const system = [
    "You write prompts for an illustrator who draws flashcard pictures for a family learning Korean and English.",
    'Answer with a single JSON object {"image_prompt": "..."}. No markdown, no comments.',
    IMAGE_PROMPT_RULES,
    LEVEL_HINT[level],
  ].join("\n");
  const label = { word: "Word", phrase: "Phrase", sentence: "Sentence", example: "Sentence" }[kind];
  const language = { ko: "Korean", en: "English" }[lang];
  return { system, user: `${label} (${language}): ${text}` };
}

/** The full prompt sent to the image model. */
export const withStyle = (imagePrompt: string) => `${imagePrompt.trim().replace(/[.\s]+$/, "")}. ${IMAGE_STYLE}`;

export type ImagePromptItem = { ref: string; kind: ImageItemKind; text: string; meaning: string };

export const wordImagePromptsSchema = z.object({
  prompts: z.array(z.object({ ref: z.string(), image_prompt: z.string().trim().min(10).max(400) })).min(1),
});

/** One request for all items of an old word (the word, its phrases and examples) that lack a prompt. */
export function buildWordImagePromptsRequest(lang: LearnLang, items: ImagePromptItem[]) {
  const system = [
    "You write prompts for an illustrator who draws flashcard pictures for a family learning Korean and English.",
    'Answer with a single JSON object {"prompts": [{"ref": "...", "image_prompt": "..."}]} with exactly one entry per input item, same refs. No markdown.',
    IMAGE_PROMPT_RULES,
  ].join("\n");
  const language = { ko: "Korean", en: "English" }[lang];
  const lines = items.map((i) => `- ref ${i.ref} (${i.kind}, ${language}): ${i.text} — meaning: ${i.meaning}`);
  return { system, user: `Items:\n${lines.join("\n")}` };
}
