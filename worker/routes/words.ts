import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { LearnLang } from "../../shared/enums";
import {
  duplicateKey,
  enrichRequestSchema,
  generateAudioRequestSchema,
  LLM_DAILY_QUOTA,
  posSchema,
  WORD_ERRORS,
  wordCreateSchema,
  wordListQuerySchema,
  type WordDetail,
  type WordSummary,
} from "../../shared/word";
import { examples, profiles, words } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { consumeQuota } from "../lib/quota";
import { zv } from "../lib/validate";
import { generateWordAudio } from "../services/audio";
import { enrichWithCache } from "../services/enrich";
import { LlmError, type LlmClient } from "../services/llm";
import type { TtsClient } from "../services/tts";

type Db = ReturnType<typeof getDb>;
type WordRow = typeof words.$inferSelect;
export type MakeLlm = (env: Env) => LlmClient | null;
export type MakeTts = (env: Env) => TtsClient | null;

class QuotaExceeded extends Error {}

const LLM_ERROR_STATUS = { not_configured: 503, unavailable: 502, invalid_output: 502 } as const;
const LLM_ERROR_CODE = {
  not_configured: WORD_ERRORS.aiNotConfigured,
  unavailable: WORD_ERRORS.aiUnavailable,
  invalid_output: WORD_ERRORS.aiInvalidOutput,
} as const;

async function findDuplicate(db: Db, lang: LearnLang, term: string) {
  const key = duplicateKey(lang, term);
  const sameTerm = lang === "en" ? sql`lower(${words.term}) = ${key}` : eq(words.term, key);
  return db.select({ id: words.id }).from(words).where(and(eq(words.lang, lang), sameTerm)).get();
}

/** Only existing adult profiles may add words or use AI (SPEC: kid restrictions). */
async function checkAdult(db: Db, profileId: string): Promise<"ok" | "not_found" | "kid"> {
  const p = await db.select({ is_kid: profiles.is_kid }).from(profiles).where(eq(profiles.id, profileId)).get();
  if (!p) return "not_found";
  return p.is_kid ? "kid" : "ok";
}

const toSummary = (w: WordRow): WordSummary => ({
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
});

/** Escapes LIKE wildcards so user input is matched literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const idParam = zv("param", z.object({ id: z.string().min(1) }));

export const wordRoutes = ({ makeLlm, makeTts }: { makeLlm: MakeLlm; makeTts: MakeTts }) =>
  new Hono<AppEnv>()
    .post("/enrich", zv("json", enrichRequestSchema), async (c) => {
      const db = getDb(c.env);
      const input = c.req.valid("json");

      const who = await checkAdult(db, input.profile_id);
      if (who === "not_found") return c.json({ error: "not_found" }, 404);
      if (who === "kid") return c.json({ error: WORD_ERRORS.kidForbidden }, 403);

      // Duplicate check first: an existing word costs no AI call.
      const dup = await findDuplicate(db, input.lang, input.term);
      if (dup) return c.json({ error: WORD_ERRORS.duplicate, existing_id: dup.id }, 409);

      const llm = makeLlm(c.env);
      if (!llm) return c.json({ error: WORD_ERRORS.aiNotConfigured }, 503);

      try {
        const result = await enrichWithCache({
          db,
          llm,
          input,
          beforeLlmCall: async () => {
            if (!(await consumeQuota(db, input.profile_id, "llm", LLM_DAILY_QUOTA))) throw new QuotaExceeded();
          },
        });
        return c.json(result);
      } catch (e) {
        if (e instanceof QuotaExceeded) return c.json({ error: WORD_ERRORS.quotaExceeded }, 429);
        if (e instanceof LlmError) {
          console.error("enrich failed:", e.message);
          return c.json({ error: LLM_ERROR_CODE[e.code] }, LLM_ERROR_STATUS[e.code]);
        }
        throw e;
      }
    })

    .post("/", zv("json", wordCreateSchema), async (c) => {
      const db = getDb(c.env);
      const { profile_id, examples: exampleInputs, ...fields } = c.req.valid("json");

      const who = await checkAdult(db, profile_id);
      if (who === "not_found") return c.json({ error: "not_found" }, 404);
      if (who === "kid") return c.json({ error: WORD_ERRORS.kidForbidden }, 403);

      const dup = await findDuplicate(db, fields.lang, fields.term);
      if (dup) return c.json({ error: WORD_ERRORS.duplicate, existing_id: dup.id }, 409);

      const id = crypto.randomUUID();
      const insertWord = db.insert(words).values({ ...fields, id, verified: false, created_by_profile: profile_id });
      // Word + examples in one D1 batch (atomic).
      if (exampleInputs.length > 0) {
        await db.batch([insertWord, db.insert(examples).values(exampleInputs.map((ex) => ({ ...ex, word_id: id })))]);
      } else {
        await insertWord;
      }

      // Audio for the word + examples. TTS problems never fail the save: items stay
      // without audio and the client offers "Generate audio" later.
      const audio = await generateWordAudio(
        { db, bucket: c.env.MEDIA, tts: makeTts(c.env), env: c.env, profileId: profile_id },
        id,
      );
      return c.json({ id, audio }, 201);
    })

    .post("/:id/audio", idParam, zv("json", generateAudioRequestSchema), async (c) => {
      const db = getDb(c.env);
      const { id } = c.req.valid("param");
      const { profile_id } = c.req.valid("json");

      const who = await checkAdult(db, profile_id);
      if (who === "not_found") return c.json({ error: "not_found" }, 404);
      if (who === "kid") return c.json({ error: WORD_ERRORS.kidForbidden }, 403);
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
        .select()
        .from(words)
        .where(and(...conditions))
        .orderBy(desc(words.created_at))
        .limit(200);
      return c.json(rows.map(toSummary));
    })

    .get("/:id", idParam, async (c) => {
      const db = getDb(c.env);
      const { id } = c.req.valid("param");
      const w = await db.select().from(words).where(eq(words.id, id)).get();
      if (!w) return c.json({ error: "not_found" }, 404);
      const exs = await db.select().from(examples).where(eq(examples.word_id, id)).orderBy(sql`rowid`);

      const detail: WordDetail = {
        ...toSummary(w),
        pos: posSchema.catch("other").parse(w.pos),
        hanja: w.hanja,
        han_viet: w.han_viet,
        notes: w.notes,
        created_at: w.created_at.getTime(),
        examples: exs.map(({ word_id: _w, ...ex }) => ex),
      };
      return c.json(detail);
    });
