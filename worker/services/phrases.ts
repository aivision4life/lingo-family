// Phrases of a root word: save (skipping duplicates), load for Word detail.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { duplicateKey } from "../../shared/base";
import type { LearnLang } from "../../shared/enums";
import { phraseInputSchema, type Phrase, type SkippedPhrase } from "../../shared/phrase";
import type { z } from "zod";
import { examples, phrases, words } from "../../db/schema";
import type { getDb } from "../env";
import { imageView } from "./imageStore";
import { initialImageFields } from "./imageJobs";

type Db = ReturnType<typeof getDb>;
type PhraseInputParsed = z.output<typeof phraseInputSchema>;

/** Existing phrase with the same language + text (English case-insensitive), with its root word's term. */
export async function findPhraseDuplicate(db: Db, lang: LearnLang, text: string) {
  const key = duplicateKey(lang, text);
  const same = lang === "en" ? sql`lower(${phrases.text}) = ${key}` : eq(phrases.text, key);
  return db
    .select({ id: phrases.id, root_term: words.term })
    .from(phrases)
    .innerJoin(words, eq(words.id, phrases.word_id))
    .where(and(eq(phrases.lang, lang), same))
    .get();
}

type SaveArgs = {
  wordId: string;
  wordTerm: string;
  lang: LearnLang;
  profileId: string;
  inputs: PhraseInputParsed[];
  /** Workers AI available: phrases with an AI prompt are claimed for drawing right away. */
  imagesOn: boolean;
};

/**
 * Saves phrases (+ their example) under a root word. Phrases that already exist — anywhere in
 * the library, or equal to the root word itself — are skipped and reported (SPEC: UNIQUE(lang, text)).
 */
export async function savePhrases(
  db: Db,
  a: SaveArgs,
): Promise<{ saved: string[]; skipped: SkippedPhrase[]; pendingImages: string[] }> {
  const saved: string[] = [];
  const pendingImages: string[] = [];
  const skipped: SkippedPhrase[] = [];
  const seen = new Set([duplicateKey(a.lang, a.wordTerm)]);

  for (const { example, ...input } of a.inputs) {
    const key = duplicateKey(a.lang, input.text);
    if (seen.has(key)) {
      skipped.push({ text: input.text, existing_word_term: a.wordTerm });
      continue;
    }
    seen.add(key);
    const dup = await findPhraseDuplicate(db, a.lang, input.text);
    if (dup) {
      skipped.push({ text: input.text, existing_word_term: dup.root_term });
      continue;
    }

    const id = crypto.randomUUID();
    const image = initialImageFields(input.image_prompt, a.imagesOn);
    if (image.image_status === "pending") pendingImages.push(id);
    const insertPhrase = db.insert(phrases).values({
      ...input,
      ...image,
      id,
      word_id: a.wordId,
      lang: a.lang,
      verified: false,
      created_by_profile: a.profileId,
    });
    // Phrase + its example in one batch; the example keeps the root word in word_id (trigger-checked).
    if (example) {
      await db.batch([insertPhrase, db.insert(examples).values({ ...example, word_id: a.wordId, phrase_id: id })]);
    } else {
      await insertPhrase;
    }
    saved.push(id);
  }
  return { saved, skipped, pendingImages };
}

/** Phrases of a word with their examples, oldest first. */
export async function loadPhrases(db: Db, wordId: string): Promise<Phrase[]> {
  const rows = await db.select().from(phrases).where(eq(phrases.word_id, wordId)).orderBy(phrases.created_at);
  if (rows.length === 0) return [];
  const exs = await db
    .select()
    .from(examples)
    .where(inArray(examples.phrase_id, rows.map((r) => r.id)))
    .orderBy(sql`rowid`);
  return rows.map((p) => ({
    id: p.id,
    word_id: p.word_id,
    lang: p.lang,
    text: p.text,
    reading: p.reading,
    gloss_vi: p.gloss_vi,
    gloss_en: p.gloss_en,
    gloss_ko: p.gloss_ko,
    emoji: p.emoji,
    audio_key: p.audio_key,
    ai_generated: p.ai_generated,
    verified: p.verified,
    ...imageView(p),
    examples: exs.filter((e) => e.phrase_id === p.id).map(toExample),
  }));
}

type ExampleRow = typeof examples.$inferSelect;

/** An example row as sent to the client. */
export const toExample = (e: ExampleRow) => ({
  id: e.id,
  sentence: e.sentence,
  translation_vi: e.translation_vi,
  translation_en: e.translation_en,
  translation_ko: e.translation_ko,
  level: e.level,
  ai_generated: e.ai_generated,
  audio_key: e.audio_key,
  ...imageView(e),
});

/** Examples of the word itself (not of its phrases). */
export const wordOnlyExamples = (db: Db, wordId: string) =>
  db
    .select()
    .from(examples)
    .where(and(eq(examples.word_id, wordId), isNull(examples.phrase_id)))
    .orderBy(sql`rowid`);
