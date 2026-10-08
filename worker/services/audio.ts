// Generates missing audio for a word and its examples: R2 first, Azure only on a miss.
import { eq } from "drizzle-orm";
import { TTS_DAILY_QUOTA } from "../../shared/word";
import { examples, words } from "../../db/schema";
import type { getDb } from "../env";
import { consumeQuota } from "../lib/quota";
import { audioKey, voiceFor, type TtsClient } from "./tts";

type Db = ReturnType<typeof getDb>;
type Item = { table: "word" | "example"; id: string; text: string };

export type AudioDeps = {
  db: Db;
  bucket: R2Bucket;
  /** null when Azure is not configured: nothing is generated, everything stays missing. */
  tts: TtsClient | null;
  /** Worker env, read for optional TTS_VOICE_* overrides. */
  env: unknown;
  /** Profile charged for Azure calls (usage_daily). */
  profileId: string;
};

/**
 * Fills `audio_key` for the word and every example that has none.
 * Never throws for TTS problems: failed items simply stay missing.
 */
export async function generateWordAudio(deps: AudioDeps, wordId: string): Promise<{ missing: number }> {
  const { db } = deps;
  const word = await db.select().from(words).where(eq(words.id, wordId)).get();
  if (!word) return { missing: 0 };
  const exs = await db.select().from(examples).where(eq(examples.word_id, wordId));

  const todo: Item[] = [
    ...(word.audio_key ? [] : [{ table: "word" as const, id: word.id, text: word.term }]),
    ...exs.filter((ex) => !ex.audio_key).map((ex) => ({ table: "example" as const, id: ex.id, text: ex.sentence })),
  ];
  if (todo.length === 0) return { missing: 0 };

  const voice = voiceFor(deps.env, word.lang);
  const results = await Promise.all(
    todo.map(async (item) => {
      try {
        const key = await ensureAudio(deps, word.lang, voice, item.text);
        if (!key) return false;
        if (item.table === "word") await db.update(words).set({ audio_key: key }).where(eq(words.id, item.id));
        else await db.update(examples).set({ audio_key: key }).where(eq(examples.id, item.id));
        return true;
      } catch (e) {
        console.error("TTS failed:", e instanceof Error ? e.message : e);
        return false;
      }
    }),
  );
  return { missing: results.filter((ok) => !ok).length };
}

/** Returns the R2 key, generating the file if needed; null if TTS is unavailable or over quota. */
async function ensureAudio(deps: AudioDeps, lang: Parameters<typeof audioKey>[0], voice: string, text: string) {
  const key = await audioKey(lang, voice, text);
  // Content-addressed: an existing file is reused for free.
  if (await deps.bucket.head(key)) return key;
  if (!deps.tts) return null;
  if (!(await consumeQuota(deps.db, deps.profileId, "tts", TTS_DAILY_QUOTA))) return null;

  const audio = await deps.tts.synthesize(text, lang, voice);
  await deps.bucket.put(key, audio, { httpMetadata: { contentType: "audio/mpeg" } });
  return key;
}
