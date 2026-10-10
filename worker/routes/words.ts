import { and, count, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { LearnLang } from "../../shared/enums";
import {
  deleteWordRequestSchema,
  duplicateKey,
  enrichRequestSchema,
  generateAudioRequestSchema,
  posSchema,
  WORD_ERRORS,
  wordCreateSchema,
  wordListQuerySchema,
  type WordDetail,
  type WordSummary,
} from "../../shared/word";
import { cards, examples, words } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";
import { runAiTask } from "../lib/aiTask";
import { runInBackground } from "../lib/background";
import { zv } from "../lib/validate";
import { generateWordAudio } from "../services/audio";
import { enrichWithCache } from "../services/enrich";
import { drawClaimedItems, initialImageFields } from "../services/imageJobs";
import { isLocalHost } from "../lib/localDev";
import { createFakeImageAi } from "../services/fakeImage";
import type { AiRunner } from "../services/imageModels";
import { imageView } from "../services/imageStore";
import type { LlmClient } from "../services/llm";
import { loadPhrases, savePhrases, toExample, wordOnlyExamples } from "../services/phrases";
import type { TtsClient } from "../services/tts";

type Db = ReturnType<typeof getDb>;
type WordRow = typeof words.$inferSelect;
export type MakeLlm = (env: Env) => LlmClient | null;
export type MakeTts = (env: Env) => TtsClient | null;
/** `requestUrl` decides whether the local-development fake provider may be used. */
export type MakeImageAi = (env: Env, requestUrl: string) => AiRunner | null;
export type ContentDeps = { makeLlm: MakeLlm; makeTts: MakeTts; makeImageAi: MakeImageAi };

/**
 * Image provider. The Workers AI binding (always remote, see wrangler.jsonc) when it exists, so
 * production and `npm run dev:ai` draw for real. Without the binding (plain `npm run dev`) a
 * local host gets the fake placeholder provider; any other host gets null (no drawing), so
 * production can never fall back to fake images.
 */
export const defaultImageAi: MakeImageAi = (env, requestUrl) => {
  const ai = env.AI as unknown as AiRunner | undefined;
  if (ai) return ai;
  return isLocalHost(requestUrl) ? createFakeImageAi() : null;
};

/** Draws the word / phrases claimed while saving, after the response (waitUntil). */
export function drawAfterSave(
  c: Context<AppEnv>,
  makeImageAi: MakeImageAi,
  profileId: string,
  items: { kind: "word" | "phrase"; id: string }[],
) {
  if (items.length === 0) return;
  const deps = { DB: c.env.DB, bucket: c.env.MEDIA, ai: makeImageAi(c.env, c.req.url), profileId };
  runInBackground(c, drawClaimedItems(deps, items));
}

async function findDuplicate(db: Db, lang: LearnLang, term: string) {
  const key = duplicateKey(lang, term);
  const sameTerm = lang === "en" ? sql`lower(${words.term}) = ${key}` : eq(words.term, key);
  return db.select({ id: words.id }).from(words).where(and(eq(words.lang, lang), sameTerm)).get();
}

// Written out in full: an interpolated column would render as a bare "id" and bind to p.id.
const phraseCount = sql<number>`(SELECT count(*) FROM phrases p WHERE p.word_id = "words"."id")`;

const toSummary = (w: WordRow, phrase_count: number): WordSummary => ({
  id: w.id,
  lang: w.lang,
  term: w.term,
  reading: w.reading,
  gloss_vi: w.gloss_vi,
  gloss_en: w.gloss_en,
  gloss_ko: w.gloss_ko,
  emoji: w.emoji,
  audio_key: w.audio_key,
  ai_generated: w.ai_generated,
  verified: w.verified,
  phrase_count,
  ...imageView(w),
});

/** Escapes LIKE wildcards so user input is matched literally. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const idParam = zv("param", z.object({ id: z.string().min(1) }));

export const wordRoutes = ({ makeLlm, makeTts, makeImageAi }: ContentDeps) =>
  new Hono<AppEnv>()
    .post("/enrich", zv("json", enrichRequestSchema), async (c) => {
      const db = getDb(c.env);
      const input = c.req.valid("json");
      const denied = await requireAdult(c, input.profile_id);
      if (denied) return denied;

      // Duplicate check first: an existing word costs no AI call.
      const dup = await findDuplicate(db, input.lang, input.term);
      if (dup) return c.json({ error: WORD_ERRORS.duplicate, existing_id: dup.id }, 409);

      const llm = makeLlm(c.env);
      if (!llm) return c.json({ error: WORD_ERRORS.aiNotConfigured }, 503);
      const run = await runAiTask(c, input.profile_id, (beforeLlmCall) =>
        enrichWithCache({ db, llm, input, beforeLlmCall }),
      );
      return run.ok ? c.json(run.result) : run.response;
    })

    .post("/", zv("json", wordCreateSchema), async (c) => {
      const db = getDb(c.env);
      const { profile_id, examples: exampleInputs, phrases: phraseInputs, ...fields } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;

      const dup = await findDuplicate(db, fields.lang, fields.term);
      if (dup) return c.json({ error: WORD_ERRORS.duplicate, existing_id: dup.id }, 409);

      const id = crypto.randomUUID();
      const imagesOn = makeImageAi(c.env, c.req.url) !== null;
      const image = initialImageFields(fields.image_prompt, imagesOn);
      const insertWord = db
        .insert(words)
        .values({ ...fields, ...image, id, verified: false, created_by_profile: profile_id });
      // Word + examples in one D1 batch (atomic).
      if (exampleInputs.length > 0) {
        await db.batch([insertWord, db.insert(examples).values(exampleInputs.map((ex) => ({ ...ex, word_id: id })))]);
      } else {
        await insertWord;
      }
      const { skipped, pendingImages } = await savePhrases(db, {
        wordId: id,
        wordTerm: fields.term,
        lang: fields.lang,
        profileId: profile_id,
        inputs: phraseInputs,
        imagesOn,
      });
      // Pictures of the word and the selected phrases are drawn in the background (SPEC F3).
      drawAfterSave(c, makeImageAi, profile_id, [
        ...(image.image_status === "pending" ? [{ kind: "word" as const, id }] : []),
        ...pendingImages.map((pid) => ({ kind: "phrase" as const, id: pid })),
      ]);

      // Audio for the word, phrases and examples. TTS problems never fail the save: items stay
      // without audio and the client offers "Generate audio" later.
      const audio = await generateWordAudio(
        { db, bucket: c.env.MEDIA, tts: makeTts(c.env), env: c.env, profileId: profile_id },
        id,
      );
      return c.json({ id, audio, skipped_phrases: skipped }, 201);
    })

    .post("/:id/audio", idParam, zv("json", generateAudioRequestSchema), async (c) => {
      const db = getDb(c.env);
      const { id } = c.req.valid("param");
      const { profile_id } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      if (!(await db.select({ id: words.id }).from(words).where(eq(words.id, id)).get())) {
        return c.json({ error: "not_found" }, 404);
      }

      const tts = makeTts(c.env);
      if (!tts) return c.json({ error: WORD_ERRORS.ttsNotConfigured }, 503);
      return c.json(await generateWordAudio({ db, bucket: c.env.MEDIA, tts, env: c.env, profileId: profile_id }, id));
    })

    .get("/", zv("query", wordListQuerySchema), async (c) => {
      const { lang, q } = c.req.valid("query");
      const conditions: SQL[] = [];
      if (lang) conditions.push(eq(words.lang, lang));
      if (q) {
        const pattern = likePattern(q);
        const fields = [words.term, words.reading, words.gloss_vi, words.gloss_en, words.gloss_ko];
        conditions.push(or(...fields.map((f) => sql`${f} LIKE ${pattern} ESCAPE '\\'`))!);
      }
      const rows = await getDb(c.env)
        .select({ word: words, phrase_count: phraseCount })
        .from(words)
        .where(and(...conditions))
        .orderBy(desc(words.created_at))
        .limit(200);
      return c.json(rows.map((r) => toSummary(r.word, r.phrase_count)));
    })

    .get("/:id", idParam, async (c) => {
      const db = getDb(c.env);
      const { id } = c.req.valid("param");
      const w = await db.select().from(words).where(eq(words.id, id)).get();
      if (!w) return c.json({ error: "not_found" }, 404);
      const [exs, phs, cardRow] = await Promise.all([
        wordOnlyExamples(db, id),
        loadPhrases(db, id),
        db.select({ n: count() }).from(cards).where(eq(cards.word_id, id)).get(),
      ]);

      const detail: WordDetail = {
        ...toSummary(w, phs.length),
        pos: posSchema.catch("other").parse(w.pos),
        hanja: w.hanja,
        han_viet: w.han_viet,
        notes: w.notes,
        created_at: w.created_at.getTime(),
        examples: exs.map(toExample),
        phrases: phs,
        card_count: cardRow?.n ?? 0,
      };
      return c.json(detail);
    })

    /**
     * Deletes a word with its phrases, examples and all profiles' cards (ON DELETE CASCADE).
     * Review logs are kept with card_id = NULL (SPEC §5, decided 2026-10-08).
     */
    .delete("/:id", idParam, zv("json", deleteWordRequestSchema), async (c) => {
      const db = getDb(c.env);
      const { id } = c.req.valid("param");
      const denied = await requireAdult(c, c.req.valid("json").profile_id);
      if (denied) return denied;
      const deleted = await db.delete(words).where(eq(words.id, id)).returning({ id: words.id });
      if (deleted.length === 0) return c.json({ error: "not_found" }, 404);
      return c.body(null, 204);
    });
