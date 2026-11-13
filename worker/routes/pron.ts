import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ApiErrorBody } from "../../shared/api/error";
import { PRON_ERRORS, PRON_FAMILY_DAILY_CAP, pronDailyQuota, pronProbeQuerySchema } from "../../shared/pron";
import { checkWav } from "../../shared/wav";
import { profiles } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { consumeTieredQuota, refundQuota } from "../lib/quota";
import { zv } from "../lib/validate";
import type { PronClient } from "../services/pronunciation";

export type MakePron = (env: Env) => PronClient | null;

const err = (error: string, message?: string): ApiErrorBody =>
  message ? { error, issues: [{ path: "body", message }] } : { error };

export const pronRoutes = ({ makePron }: { makePron: MakePron }) =>
  new Hono<AppEnv>()
    /**
     * M3.0 probe — scaffolding, not a feature. Scores one recording and returns Azure's JSON
     * untouched, so the real shape of a `ko-KR` answer is known before anything is built on it.
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
