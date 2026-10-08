// "Create images for old words" (Settings, adults): one word per call, run inside the request
// (no waitUntil, so no 30 s limit). Missing image prompts of the word, its phrases and examples
// come from one LLM call; then the word and its phrases are drawn (examples stay lazy).
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { examples, phrases, words } from "../../db/schema";
import type { getDb } from "../env";
import { drawClaimedItems, type ImageDeps } from "./imageJobs";
import { buildWordImagePromptsRequest, wordImagePromptsSchema, type ImagePromptItem } from "./imagePrompt";
import { claimImage } from "./imageStore";
import { generateStructured, type LlmClient } from "./llm";

type Db = ReturnType<typeof getDb>;

/** Words and phrases never drawn (status none) — what the backfill button still has to do. */
export async function backfillRemaining(DB: D1Database) {
  const row = await DB.prepare(
    `SELECT (SELECT count(*) FROM words WHERE image_status = 'none')
          + (SELECT count(*) FROM phrases WHERE image_status = 'none') AS n`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/** The oldest word that itself, or one of its phrases, has no image yet. */
export async function nextBackfillWord(db: Db) {
  const phraseWithout = sql`${words.id} IN (SELECT word_id FROM phrases WHERE image_status = 'none')`;
  return db
    .select()
    .from(words)
    .where(or(eq(words.image_status, "none"), phraseWithout))
    .orderBy(asc(words.created_at))
    .limit(1)
    .get();
}

/**
 * Fills missing image prompts of a word, its phrases and examples with one LLM call.
 * `beforeLlmCall` consumes the LLM quota (may throw). Returns false when nothing was missing.
 */
export async function fillImagePrompts(db: Db, llm: LlmClient, word: typeof words.$inferSelect, beforeLlmCall: () => Promise<void>) {
  const [phs, exs] = await Promise.all([
    db.select().from(phrases).where(eq(phrases.word_id, word.id)),
    db.select().from(examples).where(and(eq(examples.word_id, word.id), isNull(examples.image_prompt))),
  ]);
  const items: ImagePromptItem[] = [];
  if (!word.image_prompt) items.push({ ref: `w:${word.id}`, kind: "word", text: word.term, meaning: word.gloss_en });
  for (const p of phs) if (!p.image_prompt) items.push({ ref: `p:${p.id}`, kind: "phrase", text: p.text, meaning: p.gloss_en });
  for (const e of exs) items.push({ ref: `e:${e.id}`, kind: "example", text: e.sentence, meaning: e.translation_en });
  if (items.length === 0) return false;

  await beforeLlmCall();
  const { data } = await generateStructured(llm, wordImagePromptsSchema, buildWordImagePromptsRequest(word.lang, items));
  const byRef = new Map(data.prompts.map((p) => [p.ref, p.image_prompt]));
  const updates = items.flatMap((item) => {
    const prompt = byRef.get(item.ref);
    if (!prompt) return []; // a missing entry stays without prompt (examples then use their translation)
    const [kind, id] = [item.ref[0], item.ref.slice(2)];
    const table = kind === "w" ? words : kind === "p" ? phrases : examples;
    return [db.update(table).set({ image_prompt: prompt }).where(and(eq(table.id, id), isNull(table.image_prompt)))];
  });
  if (updates.length > 0) await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
  return true;
}

/** Claims and draws the word (if never drawn) and its never-drawn phrases. */
export async function drawWordBackfill(db: Db, deps: ImageDeps, wordId: string) {
  const word = await db.select({ status: words.image_status }).from(words).where(eq(words.id, wordId)).get();
  const phs = await db
    .select({ id: phrases.id })
    .from(phrases)
    .where(and(eq(phrases.word_id, wordId), eq(phrases.image_status, "none")));
  const candidates = [
    ...(word?.status === "none" ? [{ kind: "word" as const, id: wordId }] : []),
    ...phs.map((p) => ({ kind: "phrase" as const, id: p.id })),
  ];
  // Only items this request managed to claim are drawn (another tab may be doing the same word).
  const claimed = [];
  for (const it of candidates) if (await claimImage(deps.DB, it.kind, it.id, "backfill")) claimed.push(it);
  const results = await drawClaimedItems(deps, claimed);
  return {
    drawn: results.reduce((n, r) => n + r.drawn, 0),
    quota: results.some((r) => r.quota),
  };
}
