// Per-question vocabulary for "tap a word" (M6.2): one cached LLM call per question's whole text,
// never called at practice time — the client only ever reads the already-stored `vocab`.
import { z } from "zod";
import { stripUnderline, topikVocabEntrySchema, topikVocabListSchema, type TopikOptions, type TopikVocabEntry } from "../../shared/topik";
import { sha256Hex } from "../lib/hash";
import { checkTopikVocabEntry } from "./contentCheck";
import { cachedTask, type Db } from "./enrich";
import { generateStructured, type LlmClient } from "./llm";
import { buildTopikVocabPrompt, TOPIK_VOCAB_PROMPT_VERSION } from "./topikWordPrompt";

const llmTopikVocabSchema = z.object({ words: z.array(topikVocabEntrySchema) });

export const topikVocabCacheKey = (model: string, text: string) =>
  sha256Hex(JSON.stringify(["topik-vocab", TOPIK_VOCAB_PROMPT_VERSION, model, text]));

/**
 * The text vocabulary is generated from: the stem and each option (skipping any that is an image
 * with no text) — never `instruction`, which just repeats the same question-format boilerplate
 * across every question in a block and would otherwise add the same handful of words to each one.
 * "" when the question has nothing to tokenize (e.g. an image-only question). The stem's own
 * `<u>…</u>` underline markup (M6.5-ish) is stripped first — a display-only annotation the model
 * never needs to see, and `surface` must match the plain reading `segmentTextWithUnderline` matches
 * vocab against on the client anyway.
 */
export function topikVocabSourceText(q: { stem_text: string | null; options: TopikOptions }): string {
  return [q.stem_text ? stripUnderline(q.stem_text) : null, ...q.options.map((o) => o.text)]
    .filter((t): t is string => t !== null && t.trim() !== "")
    .join("\n");
}

/**
 * Drops any entry with a script problem (M2.11-style check) instead of failing the whole list, and
 * keeps only the first entry for a repeated `lemma` (the model is asked not to repeat one, but a
 * duplicate here would otherwise show two near-identical tap targets for the same word, e.g. 남자
 * from both "남자가" and "남자보다" in different options).
 */
function finalizeTopikVocab(logContext: string, raw: TopikVocabEntry[]): TopikVocabEntry[] {
  const out: TopikVocabEntry[] = [];
  const seenLemmas = new Set<string>();
  for (const e of raw) {
    const entry: TopikVocabEntry = { surface: e.surface.trim(), lemma: e.lemma.trim(), pos: e.pos, gloss_vi: e.gloss_vi.trim() };
    if (seenLemmas.has(entry.lemma)) continue;
    const problems = checkTopikVocabEntry(entry);
    if (problems.length > 0) {
      console.error(`[topik-vocab] dropping "${entry.surface}" (${logContext}): ${problems.join("; ")}`);
      continue;
    }
    seenLemmas.add(entry.lemma);
    out.push(entry);
  }
  return out;
}

type Options = { db: Db; llm: LlmClient; logContext: string; text: string; beforeLlmCall: () => Promise<void> };

/**
 * Generates (or reuses from `ai_cache`) the vocabulary for one question's full text. An empty
 * `text` (nothing to tokenize, e.g. an image-only question) never calls the LLM and is not counted.
 */
export async function generateTopikVocabWithCache({ db, llm, logContext, text, beforeLlmCall }: Options) {
  if (text.trim() === "") return { vocab: [] as TopikVocabEntry[], cached: true };
  const { value, cached } = await cachedTask<TopikVocabEntry[]>({
    db,
    key: await topikVocabCacheKey(llm.model, text),
    cachedSchema: topikVocabListSchema,
    beforeLlmCall,
    produce: async () => {
      const { data, model } = await generateStructured(
        llm,
        llmTopikVocabSchema,
        buildTopikVocabPrompt(text),
        (d) => d.words.flatMap((w, i) => checkTopikVocabEntry(w).map((x) => `words[${i}]: ${x}`)),
      );
      return { value: finalizeTopikVocab(logContext, data.words), model };
    },
  });
  return { vocab: value, cached };
}
