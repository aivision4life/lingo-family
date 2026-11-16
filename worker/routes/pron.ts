import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ApiErrorBody } from "../../shared/api/error";
import {
  PRON_ERRORS,
  PRON_FAMILY_DAILY_CAP,
  pronDailyQuota,
  pronProbeQuerySchema,
  pronScoreQuerySchema,
  type PronScoreQuery,
  type PronScoreResponse,
} from "../../shared/pron";
import { normalizePron } from "../../shared/pronScore";
import { checkWav } from "../../shared/wav";
import { examples, phrases, pron_attempts, profiles, words } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { consumeTieredQuota, refundQuota } from "../lib/quota";
import { zv } from "../lib/validate";
import { SPEECH_LOCALES } from "../services/azureSpeech";
import type { PronClient } from "../services/pronunciation";

export type MakePron = (env: Env) => PronClient | null;

const err = (error: string, message?: string): ApiErrorBody =>
  message ? { error, issues: [{ path: "body", message }] } : { error };

/** The word, phrase or example being practised must exist: a FK failure after a paid call is not an error message. */
const targetExists = async (db: ReturnType<typeof getDb>, q: PronScoreQuery): Promise<boolean> => {
  if (q.word_id) return !!(await db.select({ id: words.id }).from(words).where(eq(words.id, q.word_id)).get());
  if (q.phrase_id) return !!(await db.select({ id: phrases.id }).from(phrases).where(eq(phrases.id, q.phrase_id)).get());
  return !!(await db.select({ id: examples.id }).from(examples).where(eq(examples.id, q.example_id!)).get());
};

export const pronRoutes = ({ makePron }: { makePron: MakePron }) =>
  new Hono<AppEnv>()
    /**
     * M3.1 — scores one take (SPEC F5). The body is the recording, the parameters are in the query.
     *
     * The order is the whole design, and every step before the quota must be free: a bad upload, an
     * unknown profile or an item that no longer exists costs nothing. Only Azure answering with a
     * score counts a unit; anything else gives it back (`refundQuota`), because the learner got no
     * score — this is the one paid call in the app that cannot be cached, so the quota is the fence.
     *
     * The audio only passes through the Worker's memory: never R2, never D1. What is stored is the
     * four scores plus `PronDetails` (normalized, versioned), never Azure's raw body.
     */
    .post("/pron/score", zv("query", pronScoreQuerySchema), async (c) => {
      const q = c.req.valid("query");
      const db = getDb(c.env);
      const profile = await db.select({ is_kid: profiles.is_kid }).from(profiles).where(eq(profiles.id, q.profile_id)).get();
      if (!profile) return c.json(err("not_found", "profile"), 404);
      if (!(await targetExists(db, q))) return c.json(err("not_found", "word, phrase or example"), 404);

      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const wav = checkWav(bytes);
      if (!wav.ok) return c.json(err(PRON_ERRORS.invalidAudio, wav.reason), 400);

      const client = makePron(c.env);
      if (!client) return c.json(err(PRON_ERRORS.unavailable), 503);

      const now = new Date();
      if (!(await consumeTieredQuota(c.env.DB, q.profile_id, "pron", pronDailyQuota(profile.is_kid), PRON_FAMILY_DAILY_CAP, now))) {
        return c.json(err(PRON_ERRORS.quotaExceeded), 429);
      }
      const giveBack = () => refundQuota(c.env.DB, q.profile_id, "pron", now);

      let raw: unknown;
      try {
        // Kid profiles may practise speaking, so miscue marking is on for anything with a space in
        // it (a phrase or a sentence) and off for a single word, where an omission makes no sense.
        raw = await client.assess(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), q.lang, q.reference_text, {
          miscue: q.reference_text.includes(" "),
        });
      } catch (e) {
        await giveBack();
        console.error("pron score failed", e);
        return c.json(err(PRON_ERRORS.failed, e instanceof Error ? e.message : String(e)), 502);
      }

      const normalized = normalizePron(raw, SPEECH_LOCALES[q.lang]);
      if (!normalized.ok) {
        await giveBack();
        console.warn("pron score not usable:", normalized.reason);
        return c.json(err(PRON_ERRORS.noResult, normalized.reason), 422);
      }
      const { details, ...scores } = normalized.scores;

      const row = await db
        .insert(pron_attempts)
        .values({
          profile_id: q.profile_id,
          word_id: q.word_id ?? null,
          phrase_id: q.phrase_id ?? null,
          example_id: q.example_id ?? null,
          lang: q.lang,
          reference_text: q.reference_text,
          ...scores,
          duration_ms: wav.durationMs,
          details_json: details,
        })
        .returning({ id: pron_attempts.id })
        .get();

      const body: PronScoreResponse = { attempt_id: row.id, ...scores, duration_ms: wav.durationMs, details };
      return c.json(body);
    })
    /**
     * M3.0 probe — scaffolding, not a feature, kept until M3.2 (the Practice screen) replaces the
     * `/practice/probe` page that uses it. Scores one recording and returns Azure's JSON untouched.
     * Kid profiles may use it too, on their own smaller allowance. Stores nothing but the quota
     * unit, which a failed call gives back.
     */
    .post("/pron/probe", zv("query", pronProbeQuerySchema), async (c) => {
      const q = c.req.valid("query");
      const profile = await getDb(c.env).select({ is_kid: profiles.is_kid }).from(profiles).where(eq(profiles.id, q.profile_id)).get();
      if (!profile) return c.json(err("not_found"), 404);

      // Checked before the quota and before Azure: a bad upload must cost nothing.
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const wav = checkWav(bytes);
      if (!wav.ok) return c.json(err(PRON_ERRORS.invalidAudio, wav.reason), 400);

      const client = makePron(c.env);
      if (!client) return c.json(err(PRON_ERRORS.unavailable), 503);

      const now = new Date();
      if (!(await consumeTieredQuota(c.env.DB, q.profile_id, "pron", pronDailyQuota(profile.is_kid), PRON_FAMILY_DAILY_CAP, now))) {
        return c.json(err(PRON_ERRORS.quotaExceeded), 429);
      }

      const started = Date.now();
      let raw: unknown;
      try {
        raw = await client.assess(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), q.lang, q.text, {
          miscue: q.miscue === "1",
          alphabet: q.alphabet === "none" ? undefined : q.alphabet,
        });
      } catch (e) {
        await refundQuota(c.env.DB, q.profile_id, "pron", now);
        console.error("pron probe failed", e);
        return c.json(err(PRON_ERRORS.failed, e instanceof Error ? e.message : String(e)), 502);
      }
      return c.json({ raw, azure_ms: Date.now() - started, audio_ms: wav.durationMs });
    });
