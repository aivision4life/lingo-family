// Per-question answer explanation for M6.3: one cached LLM call per question (stem + options +
// the correct option + its own M6.2 vocabulary), never called at practice time — the client only
// ever reads the already-stored `explanation_vi`/`key_terms` (via the attempt response, never the
// practice session — see worker/routes/topik.ts).
import { State } from "ts-fsrs";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { isGrammarPos, type TopikKeyTermView, type TopikOptions, type TopikVocabEntry } from "../../shared/topik";
import { cards, words } from "../../db/schema";
import { sha256Hex } from "../lib/hash";
import { checkTopikExplanation } from "./contentCheck";
import { cachedTask, type Db } from "./enrich";
import { generateStructured, LlmError, type LlmClient, type LlmImagePart } from "./llm";
import { buildTopikExplainPrompt, TOPIK_EXPLAIN_PROMPT_VERSION, type ExplainInput } from "./topikExplainPrompt";

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/**
 * Fetches and base64-encodes every image a question's stem/options reference, labeling each one
 * (M6.3: an image-bearing question used to get only a "no text" placeholder, so the model could
 * only guess its content from the correct answer — attaching the real image instead). Returns
 * `{ error }` instead of a partial result when ANY referenced image can't be fetched: better to
 * generate no explanation at all than one reasoning from a guess about an image it never saw.
 */
export async function resolveExplainImages(
  bucket: R2Bucket,
  input: { stem: { image_key: string | null }; options: TopikOptions },
): Promise<{ images: LlmImagePart[] } | { error: string }> {
  const refs: { key: string; label: string }[] = [];
  if (input.stem.image_key) refs.push({ key: input.stem.image_key, label: "Hình ảnh đề bài:" });
  input.options.forEach((o, i) => {
    if (o.image_key) refs.push({ key: o.image_key, label: `Hình ảnh đáp án ${i + 1}:` });
  });
  if (refs.length === 0) return { images: [] };

  const images: LlmImagePart[] = [];
  for (const ref of refs) {
    const obj = await bucket.get(ref.key);
    if (!obj) return { error: `image ${ref.key} not found in R2` };
    const data = arrayBufferToBase64(await obj.arrayBuffer());
    const mimeType = obj.httpMetadata?.contentType ?? "image/webp";
    images.push({ label: ref.label, mimeType, data });
  }
  return { images };
}

const llmTopikExplainSchema = z.object({ explanation_vi: z.string().min(1), key_terms: z.array(z.string()) });
const cachedExplainSchema = z.object({ explanation_vi: z.string(), key_terms: z.array(z.string()) });

export const topikExplainCacheKey = (model: string, input: ExplainInput) =>
  sha256Hex(
    JSON.stringify(["topik-explain", TOPIK_EXPLAIN_PROMPT_VERSION, model, input.instruction, input.stem, input.options, input.correct_option, input.vocab]),
  );

/** Whether there is any text at all to explain (an all-image question has nothing to go on). */
export function topikExplainHasContent(input: Pick<ExplainInput, "instruction" | "stem" | "options">): boolean {
  return [input.instruction, input.stem.text, ...input.options.map((o) => o.text)].some((t) => t !== null && t.trim() !== "");
}

type Options = {
  db: Db;
  llm: LlmClient;
  logContext: string;
  input: ExplainInput;
  /** Already resolved by the caller (`resolveExplainImages`); [] when the question has no images. */
  images: LlmImagePart[];
  beforeLlmCall: () => Promise<void>;
};

/**
 * Generates (or reuses from `ai_cache`) one question's explanation. Returns `{ explanation_vi:
 * null, key_terms: [] }` without ever calling the LLM when there is nothing to explain.
 */
export async function generateTopikExplanationWithCache({ db, llm, logContext, input, images, beforeLlmCall }: Options) {
  if (!topikExplainHasContent(input)) return { explanation_vi: null as string | null, key_terms: [] as string[], cached: true };
  const lemmas = input.vocab.map((v) => v.lemma);
  // A grammar pattern or a content word may legitimately be named in Hangul (M6.3 requires naming
  // the exact pattern, e.g. "-느라고") — but only as a fragment of one of this question's own
  // surface/lemma forms, never a free-form Korean sentence the model wrote instead of translating.
  const allowedHangul = [...new Set(input.vocab.flatMap((v) => [v.surface, v.lemma]))];

  const { value, cached } = await cachedTask<{ explanation_vi: string; key_terms: string[] }>({
    db,
    key: await topikExplainCacheKey(llm.model, input),
    cachedSchema: cachedExplainSchema,
    beforeLlmCall,
    produce: async () => {
      const { data, model } = await generateStructured(
        llm,
        llmTopikExplainSchema,
        { ...buildTopikExplainPrompt(input), images },
        (d) => checkTopikExplanation(d, lemmas, allowedHangul),
      );
      // A key_terms lemma the model invented anyway (despite the retry) is filtered, never saved —
      // but a persisting script problem (stray Hangul/Han) in explanation_vi itself cannot be
      // "filtered", so that case throws (M2.11-style: a cache-miss row is simply left unset, retried
      // later) instead of ever saving a bad explanation.
      const stillBadScript = checkTopikExplanation({ explanation_vi: data.explanation_vi, key_terms: [] }, [], allowedHangul).some((p) =>
        p.startsWith("explanation_vi:"),
      );
      if (stillBadScript) {
        throw new LlmError("invalid_output", `TOPIK explanation still has a script problem after retry (${logContext})`);
      }
      const key_terms = [...new Set(data.key_terms.filter((l) => lemmas.includes(l)))].slice(0, 5);
      return { value: { explanation_vi: data.explanation_vi.trim(), key_terms }, model };
    },
  });
  return { ...value, cached };
}

/**
 * Turns a question's stored `key_terms` (lemmas) into profile-aware views for the attempt response
 * (M6.3): a grammar entry (`isGrammarPos`) always shows, since it has no library form to check.
 * For a content word: not in the library yet → shown ("new"); in the library but its `recognition`
 * card has never reached ts-fsrs's Review state → shown ("weak", with the existing word's id so the
 * client can link to it instead of offering to add it again); already at Review state → the
 * learner knows it, so it is dropped entirely. Ordered grammar first, then new, then weak, capped
 * at 5 — if everything left is "known", the result is simply shorter (or empty).
 */
export async function resolveKeyTermViews(db: Db, profileId: string, vocab: TopikVocabEntry[], keyTerms: string[]): Promise<TopikKeyTermView[]> {
  const byLemma = new Map(vocab.map((v) => [v.lemma, v]));
  const entries = keyTerms.map((l) => byLemma.get(l)).filter((v): v is TopikVocabEntry => v !== undefined);

  const grammar = entries.filter((e) => isGrammarPos(e.pos));
  const contentTerms = entries.filter((e) => !isGrammarPos(e.pos));

  const grammarViews: TopikKeyTermView[] = grammar.map((e) => ({ lemma: e.lemma, pos: e.pos, gloss_vi: e.gloss_vi, existing_word_id: null }));
  if (contentTerms.length === 0) return grammarViews;

  const wordRows = await db
    .select({ id: words.id, term: words.term })
    .from(words)
    .where(and(eq(words.lang, "ko"), inArray(words.term, contentTerms.map((e) => e.lemma))));
  const wordByTerm = new Map(wordRows.map((w) => [w.term, w.id]));

  const wordIds = [...wordByTerm.values()];
  const cardRows =
    wordIds.length === 0
      ? []
      : await db
          .select({ word_id: cards.word_id, state: cards.state })
          .from(cards)
          .where(and(eq(cards.profile_id, profileId), eq(cards.card_type, "recognition"), inArray(cards.word_id, wordIds)));
  const stateByWordId = new Map(cardRows.map((c) => [c.word_id, c.state]));

  const newViews: TopikKeyTermView[] = [];
  const weakViews: TopikKeyTermView[] = [];
  for (const e of contentTerms) {
    const wordId = wordByTerm.get(e.lemma);
    if (!wordId) {
      newViews.push({ lemma: e.lemma, pos: e.pos, gloss_vi: e.gloss_vi, existing_word_id: null });
      continue;
    }
    const state = stateByWordId.get(wordId);
    if (state === State.Review) continue; // already known: dropped
    weakViews.push({ lemma: e.lemma, pos: e.pos, gloss_vi: e.gloss_vi, existing_word_id: wordId });
  }

  return [...grammarViews, ...newViews, ...weakViews].slice(0, 5);
}
