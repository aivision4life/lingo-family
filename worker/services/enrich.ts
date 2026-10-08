// AI enrichment and phrase suggestions: cache-first lookup in ai_cache, otherwise one (retried) LLM call.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { duplicateKey, normalizeTerm, type LlmSentence } from "../../shared/base";
import type { ExampleLevel, LearnLang } from "../../shared/enums";
import { llmPhraseSchema, llmPhraseSuggestionsSchema, PHRASES_MAX, type LlmPhrase } from "../../shared/phrase";
import { enrichmentSchema, llmEnrichmentSchema, type Enrichment, type LlmEnrichment } from "../../shared/word";
import { ai_cache } from "../../db/schema";
import type { getDb } from "../env";
import { sha256Hex } from "../lib/hash";
import { buildEnrichPrompt, buildPhrasePrompt, ENRICH_PROMPT_VERSION, PHRASES_PROMPT_VERSION } from "./enrichPrompt";
import { generateStructured, type LlmClient } from "./llm";

type Input = { lang: LearnLang; term: string; level: ExampleLevel };

/** SPEC: 2 examples per word, 1 per phrase. */
const WORD_EXAMPLES = 2;

export const enrichCacheKey = (model: string, { lang, term, level }: Input) =>
  sha256Hex(JSON.stringify(["enrich", ENRICH_PROMPT_VERSION, model, lang, term, level]));

export const phrasesCacheKey = (model: string, { lang, term, level }: Input) =>
  sha256Hex(JSON.stringify(["phrases", PHRASES_PROMPT_VERSION, model, lang, term, level]));

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

/** A sentence is never translated into its own language. */
const cleanSentence = (lang: LearnLang, ex: LlmSentence): LlmSentence => ({
  sentence: ex.sentence.trim(),
  translation_vi: ex.translation_vi.trim(),
  translation_en: lang === "en" ? "" : ex.translation_en.trim(),
  translation_ko: lang === "ko" ? "" : ex.translation_ko.trim(),
  image_prompt: ex.image_prompt.trim(),
});

/** Trims phrases, drops ones equal to the word or to each other, keeps at most 3. */
export function finalizePhrases(lang: LearnLang, term: string, raw: LlmPhrase[]): LlmPhrase[] {
  const seen = new Set([duplicateKey(lang, term)]);
  const out: LlmPhrase[] = [];
  for (const p of raw) {
    const key = duplicateKey(lang, p.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      text: normalizeTerm(p.text),
      reading: p.reading.trim(),
      gloss_vi: p.gloss_vi.trim(),
      gloss_en: p.gloss_en.trim(),
      gloss_ko: p.gloss_ko.trim(),
      image_prompt: p.image_prompt.trim(),
      example: cleanSentence(lang, p.example),
    });
  }
  return out.slice(0, PHRASES_MAX);
}

/** Applies per-language rules the model might not follow exactly, and "" → null. */
export function finalizeEnrichment(lang: LearnLang, term: string, raw: LlmEnrichment): Enrichment {
  const isEnglish = lang === "en";
  return {
    ...raw,
    hanja: isEnglish ? null : orNull(raw.hanja),
    han_viet: isEnglish ? null : orNull(raw.han_viet),
    emoji: orNull(raw.emoji),
    image_prompt: raw.image_prompt.trim(),
    examples: raw.examples.slice(0, WORD_EXAMPLES).map((ex) => cleanSentence(lang, ex)),
    phrases: finalizePhrases(lang, term, raw.phrases),
  };
}

type Db = ReturnType<typeof getDb>;

/** Generic cache-first LLM task: returns the cached value, or produces, validates and stores a new one. */
async function cachedTask<T>(o: {
  db: Db;
  key: string;
  /** Validates a cached value (invalid or outdated entries are regenerated). */
  cachedSchema: z.ZodType<T>;
  /** Runs only on a cache miss, right before the LLM call (quota check, counted once); may throw. */
  beforeLlmCall: () => Promise<void>;
  /** Returns the value and the model that actually answered (primary or fallback). */
  produce: () => Promise<{ value: T; model: string }>;
}): Promise<{ value: T; cached: boolean }> {
  const hit = await o.db.select().from(ai_cache).where(eq(ai_cache.key, o.key)).get();
  const cached = hit && o.cachedSchema.safeParse(hit.response_json);
  if (cached?.success) return { value: cached.data, cached: true };

  await o.beforeLlmCall();
  const { value, model } = await o.produce();
  await o.db
    .insert(ai_cache)
    .values({ key: o.key, response_json: value, model })
    .onConflictDoUpdate({ target: ai_cache.key, set: { response_json: value, model, created_at: new Date() } });
  return { value, cached: false };
}

type Options = { db: Db; llm: LlmClient; input: Input; beforeLlmCall: () => Promise<void> };

export async function enrichWithCache({ db, llm, input, beforeLlmCall }: Options) {
  const { value, cached } = await cachedTask({
    db,
    key: await enrichCacheKey(llm.model, input),
    cachedSchema: enrichmentSchema,
    beforeLlmCall,
    produce: async () => {
      const { data, model } = await generateStructured(llm, llmEnrichmentSchema, buildEnrichPrompt(input.lang, input.term, input.level));
      return { value: finalizeEnrichment(input.lang, input.term, data), model };
    },
  });
  return { enrichment: value, cached };
}

/** "Suggest phrases" for a word that is already in the library. */
export async function suggestPhrasesWithCache({ db, llm, input, beforeLlmCall }: Options) {
  const { value, cached } = await cachedTask({
    db,
    key: await phrasesCacheKey(llm.model, input),
    // After filtering, a cached result may hold 0 phrases; that is still a valid answer.
    cachedSchema: z.object({ phrases: z.array(llmPhraseSchema).max(PHRASES_MAX) }),
    beforeLlmCall,
    produce: async () => {
      const { data: raw, model } = await generateStructured(
        llm,
        llmPhraseSuggestionsSchema,
        buildPhrasePrompt(input.lang, input.term, input.level),
      );
      return { value: { phrases: finalizePhrases(input.lang, input.term, raw.phrases) }, model };
    },
  });
  return { phrases: value.phrases, cached };
}
