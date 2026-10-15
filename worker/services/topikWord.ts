// Per-question vocabulary for "tap a word" (M6.2): one cached LLM call per question's whole text,
// never called at practice time — the client only ever reads the already-stored `vocab`.
import { z } from "zod";
import { topikVocabEntrySchema, topikVocabListSchema, type TopikOptions, type TopikVocabEntry } from "../../shared/topik";
import { sha256Hex } from "../lib/hash";
import { checkTopikVocabEntry } from "./contentCheck";
import { cachedTask, type Db } from "./enrich";
import { generateStructured, type LlmClient } from "./llm";
import { buildTopikVocabPrompt, TOPIK_VOCAB_PROMPT_VERSION } from "./topikWordPrompt";

const llmTopikVocabSchema = z.object({ words: z.array(topikVocabEntrySchema) });

export const topikVocabCacheKey = (model: string, text: string) =>
  sha256Hex(JSON.stringify(["topik-vocab", TOPIK_VOCAB_PROMPT_VERSION, model, text]));

/** All the Korean text a question has, joined for one prompt: instruction, stem, then each option
 * (skipping any that is an image with no text). "" when the question has nothing to tokenize. */
export function topikQuestionFullText(q: { instruction: string | null; stem_text: string | null; options: TopikOptions }): string {
  return [q.instruction, q.stem_text, ...q.options.map((o) => o.text)]
    .filter((t): t is string => t !== null && t.trim() !== "")
    .join("\n");
}

/** Drops any entry with a script problem (M2.11-style check) instead of failing the whole list. */
function finalizeTopikVocab(logContext: string, raw: TopikVocabEntry[]): TopikVocabEntry[] {
  const out: TopikVocabEntry[] = [];
  for (const e of raw) {
    const entry: TopikVocabEntry = { surface: e.surface.trim(), lemma: e.lemma.trim(), pos: e.pos, gloss_vi: e.gloss_vi.trim() };
    const problems = checkTopikVocabEntry(entry);
    if (problems.length > 0) {
      console.error(`[topik-vocab] dropping "${entry.surface}" (${logContext}): ${problems.join("; ")}`);
      continue;
    }
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
