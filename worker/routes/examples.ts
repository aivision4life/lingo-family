// Add / edit / delete example sentences of saved words and phrases (M2.6). Adults only.
import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import {
  EXAMPLE_ERRORS,
  exampleCreateSchema,
  exampleDeleteSchema,
  examplePatchSchema,
  PHRASE_EXAMPLES_MAX,
  sentenceChanged,
  WORD_EXAMPLES_MAX,
  withoutOwnTranslation,
} from "../../shared/exampleEdit";
import { examples, phrases, words } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";
import { runInBackground } from "../lib/background";
import { zv } from "../lib/validate";
import { generateWordAudio } from "../services/audio";
import { drawClaimedItems, initialImageFields } from "../services/imageJobs";
import { claimImage, newNonce } from "../services/imageStore";
import type { ContentDeps } from "./words";

const idParam = zv("param", z.object({ id: z.string().min(1) }));

export const exampleRoutes = ({ makeTts, makeImageAi }: ContentDeps) => {
  const audio = (c: Context<AppEnv>, profileId: string, wordId: string) =>
    generateWordAudio({ db: getDb(c.env), bucket: c.env.MEDIA, tts: makeTts(c.env), env: c.env, profileId }, wordId);

  const drawInBackground = (c: Context<AppEnv>, profileId: string, id: string) =>
    runInBackground(c, drawClaimedItems({ DB: c.env.DB, bucket: c.env.MEDIA, ai: makeImageAi(c.env, c.req.url), profileId }, [{ kind: "example", id }]));

  return new Hono<AppEnv>()
    .post("/words/:id/examples", idParam, zv("json", exampleCreateSchema), async (c) => {
      const db = getDb(c.env);
      const { id: wordId } = c.req.valid("param");
      const { profile_id, phrase_id, sentence, ...fields } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const word = await db.select().from(words).where(eq(words.id, wordId)).get();
      if (!word) return c.json({ error: "not_found" }, 404);

      // The owner is the word itself, or one of its phrases (then `word_id` stays the root word).
      if (phrase_id) {
        const phrase = await db.select({ id: phrases.id }).from(phrases).where(and(eq(phrases.id, phrase_id), eq(phrases.word_id, wordId))).get();
        if (!phrase) return c.json({ error: "not_found" }, 404);
      }
      const owner = phrase_id ? eq(examples.phrase_id, phrase_id) : and(eq(examples.word_id, wordId), isNull(examples.phrase_id));
      const existing = await db.select({ sentence: examples.sentence }).from(examples).where(owner);
      if (existing.length >= (phrase_id ? PHRASE_EXAMPLES_MAX : WORD_EXAMPLES_MAX)) return c.json({ error: EXAMPLE_ERRORS.tooMany }, 409);
      if (existing.some((e) => !sentenceChanged(e.sentence, sentence))) return c.json({ error: EXAMPLE_ERRORS.duplicate }, 409);

      const id = crypto.randomUUID();
      const imagesOn = makeImageAi(c.env, c.req.url) !== null;
      const image = initialImageFields(fields.image_prompt, imagesOn);
      await db.insert(examples).values({ ...withoutOwnTranslation(word.lang, fields), ...image, id, word_id: wordId, phrase_id, sentence });
      // A picture asked for with an AI prompt is drawn right away; otherwise it is drawn lazily when first shown.
      if (image.image_status === "pending") drawInBackground(c, profile_id, id);
      return c.json({ id, audio: await audio(c, profile_id, wordId) }, 201);
    })

    .patch("/examples/:id", idParam, zv("json", examplePatchSchema), async (c) => {
      const db = getDb(c.env);
      const { id } = c.req.valid("param");
      const { profile_id, redraw_image, sentence, image_prompt, ...rest } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const ex = await db.select().from(examples).where(eq(examples.id, id)).get();
      if (!ex) return c.json({ error: "not_found" }, 404);
      const word = await db.select({ lang: words.lang }).from(words).where(eq(words.id, ex.word_id)).get();
      if (!word) return c.json({ error: "not_found" }, 404);

      // New text → new audio (the R2 key follows the text; the old file stays in R2).
      const textChanged = sentence !== undefined && sentenceChanged(ex.sentence, sentence);
      if (textChanged) {
        const owner = ex.phrase_id ? eq(examples.phrase_id, ex.phrase_id) : and(eq(examples.word_id, ex.word_id), isNull(examples.phrase_id));
        const siblings = await db.select({ id: examples.id, sentence: examples.sentence }).from(examples).where(owner);
        if (siblings.some((s) => s.id !== id && !sentenceChanged(s.sentence, sentence))) return c.json({ error: EXAMPLE_ERRORS.duplicate }, 409);
      }
      await db
        .update(examples)
        .set({
          ...withoutOwnTranslation(word.lang, rest),
          ...(sentence !== undefined ? { sentence } : {}),
          ...(image_prompt !== undefined ? { image_prompt } : {}),
          ...(textChanged ? { audio_key: null } : {}),
        })
        .where(eq(examples.id, id));

      // "Update picture with AI": a new nonce gives a new R2 key; the previous picture is kept in R2.
      if (redraw_image) {
        if (!(image_prompt ?? ex.image_prompt)) return c.json({ error: "image_prompt_required" }, 400);
        if (makeImageAi(c.env, c.req.url) && (await claimImage(c.env.DB, "example", id, "redraw", { nonce: newNonce(), prompt: image_prompt ?? undefined }))) {
          drawInBackground(c, profile_id, id);
        }
      }
      return c.json({ id, audio: textChanged ? await audio(c, profile_id, ex.word_id) : { missing: 0 } });
    })

    /** Deletes the sentence only. Practice history keeps its row (the link becomes NULL, migration 0006). */
    .delete("/examples/:id", idParam, zv("json", exampleDeleteSchema), async (c) => {
      const { id } = c.req.valid("param");
      const denied = await requireAdult(c, c.req.valid("json").profile_id);
      if (denied) return denied;
      const deleted = await getDb(c.env).delete(examples).where(eq(examples.id, id)).returning({ id: examples.id });
      return deleted.length === 0 ? c.json({ error: "not_found" }, 404) : c.body(null, 204);
    });
};
