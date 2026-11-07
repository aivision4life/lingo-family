// Generates missing audio for a word and its examples: R2 first, Azure only on a miss.
import { eq } from "drizzle-orm";
import { classifyTtsError, worstFailure, type AudioFailure } from "../../shared/audioFailure";
import { TTS_DAILY_QUOTA } from "../../shared/word";
import { examples, phrases, words } from "../../db/schema";
import type { getDb } from "../env";
import { consumeQuota, refundQuota } from "../lib/quota";
import { audioKey, voiceFor, type TtsClient } from "./tts";

type Db = ReturnType<typeof getDb>;
type Item = { table: "word" | "phrase" | "example"; id: string; text: string };

export type AudioDeps = {
  db: Db;
  bucket: R2Bucket;
  /** null when Azure is not configured: nothing is generated, everything stays missing. */
  tts: TtsClient | null;
  /** Worker env, read for optional TTS_VOICE_* overrides. */
  env: unknown;
  /** The raw D1 binding, for refunding a quota unit a failed call should not have cost. */
  DB: D1Database;
  /** Profile charged for Azure calls (usage_daily). */
  profileId: string;
};

/**
 * Fills `audio_key` for the word, its phrases and every example (of the word or of its
 * phrases — they all carry the root word in word_id) that has none.
 *
 * Never throws for TTS problems: failed items simply stay missing — but since M7.13 the run also
 * says **why**, because "come back later" and "this key will never work" are not the same advice
 * and the screen had no way to tell them apart.
 */
export async function generateWordAudio(deps: AudioDeps, wordId: string): Promise<{ missing: number; reason: AudioFailure | null }> {
  const { db } = deps;
  const word = await db.select().from(words).where(eq(words.id, wordId)).get();
  if (!word) return { missing: 0, reason: null };
  const exs = await db.select().from(examples).where(eq(examples.word_id, wordId));
  const phs = await db.select().from(phrases).where(eq(phrases.word_id, wordId));

  const todo: Item[] = [
    ...(word.audio_key ? [] : [{ table: "word" as const, id: word.id, text: word.term }]),
    ...phs.filter((p) => !p.audio_key).map((p) => ({ table: "phrase" as const, id: p.id, text: p.text })),
    ...exs.filter((ex) => !ex.audio_key).map((ex) => ({ table: "example" as const, id: ex.id, text: ex.sentence })),
  ];
  if (todo.length === 0) return { missing: 0, reason: null };

  const voice = voiceFor(deps.env, word.lang);
  const results = await Promise.all(
    todo.map(async (item): Promise<AudioFailure | null> => {
      const made = await ensureAudio(deps, word.lang, voice, item.text);
      if (!made.ok) return made.reason;
      const key = made.key;
      if (item.table === "word") await db.update(words).set({ audio_key: key }).where(eq(words.id, item.id));
      else if (item.table === "phrase") await db.update(phrases).set({ audio_key: key }).where(eq(phrases.id, item.id));
      else await db.update(examples).set({ audio_key: key }).where(eq(examples.id, item.id));
      return null;
    }),
  );
  const failures = results.filter((r): r is AudioFailure => r !== null);
  return { missing: failures.length, reason: worstFailure(failures) };
}

type Made = { ok: true; key: string } | { ok: false; reason: AudioFailure };

/** Returns the R2 key, generating the file if needed, or why it could not be made. */
async function ensureAudio(deps: AudioDeps, lang: Parameters<typeof audioKey>[0], voice: string, text: string): Promise<Made> {
  const key = await audioKey(lang, voice, text);
  // Content-addressed: an existing file is reused for free.
  if (await deps.bucket.head(key)) return { ok: true, key };
  if (!deps.tts) return { ok: false, reason: "not_configured" };
  if (!(await consumeQuota(deps.db, deps.profileId, "tts", TTS_DAILY_QUOTA))) return { ok: false, reason: "quota" };

  try {
    const audio = await deps.tts.synthesize(text, lang, voice);
    await deps.bucket.put(key, audio, { httpMetadata: { contentType: "audio/mpeg" } });
    return { ok: true, key };
  } catch (e) {
    // Only a drawing that actually succeeded is billed (M2.9); the same now goes for a recording.
    // 30 units of a 200/day allowance went on nothing but HTTP 401s on the day this was found.
    await refundQuota(deps.DB, deps.profileId, "tts");
    const message = e instanceof Error ? e.message : String(e);
    console.error("TTS failed:", message);
    return { ok: false, reason: classifyTtsError(message) };
  }
}
