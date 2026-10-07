// Word enrichment: cache-first lookup in ai_cache, otherwise one (retried) LLM call.
import { eq } from "drizzle-orm";
import type { ExampleLevel, LearnLang } from "../../shared/enums";
import { enrichmentSchema, llmEnrichmentSchema, type Enrichment, type LlmEnrichment } from "../../shared/word";
import { ai_cache } from "../../db/schema";
import type { getDb } from "../env";
import { sha256Hex } from "../lib/hash";
import { buildEnrichPrompt, ENRICH_PROMPT_VERSION } from "./enrichPrompt";
import { generateStructured, type LlmClient } from "./llm";

type Input = { lang: LearnLang; term: string; level: ExampleLevel };

export const enrichCacheKey = (model: string, { lang, term, level }: Input) =>
  sha256Hex(JSON.stringify(["enrich", ENRICH_PROMPT_VERSION, model, lang, term, level]));

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

/** Applies per-language rules the model might not follow exactly, and "" → null. */
export function finalizeEnrichment(lang: LearnLang, term: string, raw: LlmEnrichment): Enrichment {
  const isEnglish = lang === "en";
  return {
    ...raw,
    hanzi_simplified: isEnglish ? null : lang === "zh" ? term : orNull(raw.hanzi_simplified),
    hanzi_traditional: isEnglish ? null : orNull(raw.hanzi_traditional),
    han_viet: isEnglish ? null : orNull(raw.han_viet),
    emoji: orNull(raw.emoji),
    examples: raw.examples.map((ex) => ({
      sentence: ex.sentence.trim(),
      translation_vi: ex.translation_vi.trim(),
      // A sentence is never translated into its own language.
      translation_en: lang === "en" ? "" : ex.translation_en.trim(),
      translation_ko: lang === "ko" ? "" : ex.translation_ko.trim(),
    })),
  };
}

type Options = {
  db: ReturnType<typeof getDb>;
  llm: LlmClient;
  input: Input;
  /** Runs only on a cache miss, right before the LLM call (quota check); may throw. */
  beforeLlmCall: () => Promise<void>;
};

export async function enrichWithCache({ db, llm, input, beforeLlmCall }: Options) {
  const key = await enrichCacheKey(llm.model, input);

  const hit = await db.select().from(ai_cache).where(eq(ai_cache.key, key)).get();
  const cached = hit && enrichmentSchema.safeParse(hit.response_json);
  if (cached?.success) return { enrichment: cached.data, cached: true };

  await beforeLlmCall();
  const raw = await generateStructured(llm, llmEnrichmentSchema, buildEnrichPrompt(input.lang, input.term, input.level));
  const enrichment = finalizeEnrichment(input.lang, input.term, raw);

  await db
    .insert(ai_cache)
    .values({ key, response_json: enrichment })
    .onConflictDoUpdate({ target: ai_cache.key, set: { response_json: enrichment, created_at: new Date() } });
  return { enrichment, cached: false };
}
