import { and, desc, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  PHRASE_ERRORS,
  phraseUpdateSchema,
  savePhrasesRequestSchema,
  suggestPhrasesRequestSchema,
  type PhraseSummary,
} from "../../shared/phrase";
import { WORD_ERRORS, wordListQuerySchema } from "../../shared/word";
import { examples, phrases, words } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";
import { runAiTask } from "../lib/aiTask";
import { zv } from "../lib/validate";
import { generateWordAudio } from "../services/audio";
import { suggestPhrasesWithCache } from "../services/enrich";
import { imageView } from "../services/imageStore";
import { findPhraseDuplicate, savePhrases } from "../services/phrases";
import { drawAfterSave, likePattern, type ContentDeps } from "./words";

const idParam = zv("param", z.object({ id: z.string().min(1) }));
const deleteBody = zv("json", z.object({ profile_id: z.string().min(1) }));

/** Mounted at /api: /words/:id/phrases… and /phrases… */
export const phraseRoutes = ({ makeLlm, makeTts, makeImageAi }: ContentDeps) =>
  new Hono<AppEnv>()
    /** AI phrase suggestions for a word already in the library (cache-first, LLM quota). */
    .post("/words/:id/phrases/suggest", idParam, zv("json", suggestPhrasesRequestSchema), async (c) => {
      const db = getDb(c.env);
      const { id } = c.req.valid("param");
      const { profile_id, level } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const word = await db.select().from(words).where(eq(words.id, id)).get();
      if (!word) return c.json({ error: "not_found" }, 404);

      const llm = makeLlm(c.env);
      if (!llm) return c.json({ error: WORD_ERRORS.aiNotConfigured }, 503);
      const input = { lang: word.lang, term: word.term, level };
      const run = await runAiTask(c, profile_id, (beforeLlmCall) =>
        suggestPhrasesWithCache({ db, llm, input, beforeLlmCall }),
      );
      return run.ok ? c.json(run.result) : run.response;
    })

    /** Save phrases (AI or typed by hand) under a word; duplicates are skipped and reported. */
    .post("/words/:id/phrases", idParam, zv("json", savePhrasesRequestSchema), async (c) => {
      const db = getDb(c.env);
      const { id } = c.req.valid("param");
      const { profile_id, phrases: inputs } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const word = await db.select().from(words).where(eq(words.id, id)).get();
      if (!word) return c.json({ error: "not_found" }, 404);

      const imagesOn = makeImageAi(c.env) !== null;
      const { pendingImages, ...result } = await savePhrases(db, {
        wordId: id, wordTerm: word.term, lang: word.lang, profileId: profile_id, inputs, imagesOn,
      });
      drawAfterSave(c, makeImageAi, profile_id, pendingImages.map((pid) => ({ kind: "phrase" as const, id: pid })));
      const audio = await generateWordAudio(
        { db, bucket: c.env.MEDIA, tts: makeTts(c.env), env: c.env, profileId: profile_id },
        id,
      );
      return c.json({ ...result, audio }, 201);
    })

    /** Library list of phrases (filter "Phrases"). */
    .get("/phrases", zv("query", wordListQuerySchema), async (c) => {
      const { lang, q } = c.req.valid("query");
      const conditions: SQL[] = [];
      if (lang) conditions.push(eq(phrases.lang, lang));
      if (q) {
        const pattern = likePattern(q);
        const fields = [phrases.text, phrases.reading, phrases.gloss_vi, phrases.gloss_en, phrases.gloss_ko, words.term];
        conditions.push(or(...fields.map((f) => sql`${f} LIKE ${pattern} ESCAPE '\\'`))!);
      }
      const rows = await getDb(c.env)
        .select({ phrase: phrases, root_term: words.term })
        .from(phrases)
        .innerJoin(words, eq(words.id, phrases.word_id))
        .where(and(...conditions))
        .orderBy(desc(phrases.created_at))
        .limit(200);
      const list: PhraseSummary[] = rows.map(({ phrase: p, root_term }) => ({
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
        root_term,
      }));
      return c.json(list);
    })

    /** Edit a phrase; cards and progress are kept. A changed text gets new audio. */
    .patch("/phrases/:id", idParam, zv("json", phraseUpdateSchema), async (c) => {
      const db = getDb(c.env);
      const { id } = c.req.valid("param");
      const { profile_id, example, ...fields } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const phrase = await db.select().from(phrases).where(eq(phrases.id, id)).get();
      if (!phrase) return c.json({ error: "not_found" }, 404);

      if (fields.text !== undefined && fields.text !== phrase.text) {
        const dup = await findPhraseDuplicate(db, phrase.lang, fields.text);
        if (dup && dup.id !== id) {
          return c.json({ error: PHRASE_ERRORS.duplicate, existing_word_term: dup.root_term }, 409);
        }
      }
      const textChanged = fields.text !== undefined && fields.text !== phrase.text;
      await db
        .update(phrases)
        .set({ ...fields, ...(textChanged ? { audio_key: null } : {}), updated_at: new Date() })
        .where(eq(phrases.id, id));

      // The phrase keeps at most one example: replace it (or remove it with `example: null`).
      // Same sentence → only translations change: update in place, keeping its audio and image.
      if (example !== undefined) {
        const old = await db.select().from(examples).where(eq(examples.phrase_id, id)).get();
        if (example && old && old.sentence === example.sentence) {
          const { translation_vi, translation_en, translation_ko, level } = example;
          await db.update(examples).set({ translation_vi, translation_en, translation_ko, level }).where(eq(examples.id, old.id));
        } else {
          await db.delete(examples).where(and(eq(examples.phrase_id, id), isNotNull(examples.phrase_id)));
          if (example) await db.insert(examples).values({ ...example, word_id: phrase.word_id, phrase_id: id });
        }
      }
      const audio = await generateWordAudio(
        { db, bucket: c.env.MEDIA, tts: makeTts(c.env), env: c.env, profileId: profile_id },
        phrase.word_id,
      );
      return c.json({ id, audio });
    })

    /** Delete a phrase with its example and cards; review logs are kept (card_id → NULL). */
    .delete("/phrases/:id", idParam, deleteBody, async (c) => {
      const { id } = c.req.valid("param");
      const denied = await requireAdult(c, c.req.valid("json").profile_id);
      if (denied) return denied;
      const deleted = await getDb(c.env).delete(phrases).where(eq(phrases.id, id)).returning({ id: phrases.id });
      if (deleted.length === 0) return c.json({ error: "not_found" }, 404);
      return c.body(null, 204);
    });
