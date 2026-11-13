import { sql } from "drizzle-orm";
import type { UsageService } from "../../shared/enums";
import { usage_daily } from "../../db/schema";
import type { getDb } from "../env";

/** Quota day in UTC, as stored in usage_daily.date. */
export const usageDate = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Atomically counts one use of `service` for `profileId` today.
 * Returns false (and counts nothing) when the daily `limit` is already reached.
 */
export async function consumeQuota(
  db: ReturnType<typeof getDb>,
  profileId: string,
  service: UsageService,
  limit: number,
  now = new Date(),
): Promise<boolean> {
  const rows = await db
    .insert(usage_daily)
    .values({ date: usageDate(now), profile_id: profileId, service, count: 1 })
    .onConflictDoUpdate({
      target: [usage_daily.date, usage_daily.profile_id, usage_daily.service],
      set: { count: sql`${usage_daily.count} + 1` },
      setWhere: sql`${usage_daily.count} < ${limit}`,
    })
    .returning({ count: usage_daily.count });
  return rows.length > 0;
}

/**
 * Logs one use of `service` for `profileId` today, with no daily cap (M6.2: generating a TOPIK
 * question's tap-a-word vocabulary is exempt from the 50/day LLM quota — it is content work, not
 * a practice action — but every call is still counted here so usage stays visible).
 */
export async function recordUsage(
  db: ReturnType<typeof getDb>,
  profileId: string,
  service: UsageService,
  now = new Date(),
): Promise<void> {
  await db
    .insert(usage_daily)
    .values({ date: usageDate(now), profile_id: profileId, service, count: 1 })
    .onConflictDoUpdate({
      target: [usage_daily.date, usage_daily.profile_id, usage_daily.service],
      set: { count: sql`${usage_daily.count} + 1` },
    });
}

/**
 * Two-tier quota (images since M2.8, pronunciation scoring since M3): at most `perProfile` uses of
 * `service` for this profile **and** at most `familyCap` for all profiles together today. Returns
 * false (and counts nothing) when either limit is reached. The one statement both services go
 * through — never write a second copy of it.
 *
 * Both limits are checked and the unit is taken in ONE statement. What stands behind "two requests
 * cannot both take the last unit" is two different kinds of evidence (measured 2026-11-13):
 *
 * - **Tested** (`quota.test.ts`): 20 calls issued together with one unit left — for one profile, and
 *   for 20 profiles under the family cap — take it exactly once. The test has teeth for the mistake
 *   that is actually likely here: rewritten as "SELECT the counts, then INSERT/UPDATE", all 20 calls
 *   win (20, not 2). Dropping `count < ?3`, or the `service` filter in the family sum, fails it too.
 * - **Reasoned, not tested**: that a single statement is atomic on production D1. Local D1
 *   (Miniflare) runs one SQLite and executes statements one after another, so no test here can make
 *   two statements overlap *inside* the engine; that part rests on SQLite's and D1's own guarantee
 *   for one statement. The test above only proves the check and the write are not split across
 *   statements — which is the property this code controls.
 */
export async function consumeTieredQuota(
  DB: D1Database,
  profileId: string,
  service: UsageService,
  perProfile: number,
  familyCap: number,
  now = new Date(),
): Promise<boolean> {
  const date = usageDate(now);
  const familyUsed = "(SELECT coalesce(sum(count), 0) FROM usage_daily WHERE date = ?1 AND service = ?5)";
  const row = await DB.prepare(
    `INSERT INTO usage_daily (date, profile_id, service, count)
       SELECT ?1, ?2, ?5, 1 WHERE ${familyUsed} < ?4
     ON CONFLICT (date, profile_id, service) DO UPDATE SET count = count + 1
       WHERE count < ?3 AND ${familyUsed} < ?4
     RETURNING count`,
  )
    .bind(date, profileId, perProfile, familyCap, service)
    .first<{ count: number }>();
  return row !== null;
}

/** Image quota (SPEC F3): `consumeTieredQuota` for service `image`. */
export const consumeImageQuota = (DB: D1Database, profileId: string, perProfile: number, familyCap: number, now = new Date()) =>
  consumeTieredQuota(DB, profileId, "image", perProfile, familyCap, now);

/**
 * Gives back one unit of today's quota for `profileId` (M2.9 for images, M7.13 for TTS): the call
 * was attempted and failed, so in the end it should not count against the daily limit. Never goes
 * below 0; does nothing if there is no row yet (nothing was ever consumed for this profile today).
 *
 * The check-and-consume step is still one statement (`consumeTieredQuota`), so a failed attempt
 * does not open a window for two requests to take the same last unit. Names its service: a refund
 * for one service never touches another's row (`quota.test.ts`).
 */
export async function refundQuota(DB: D1Database, profileId: string, service: UsageService, now = new Date()): Promise<void> {
  await DB.prepare("UPDATE usage_daily SET count = max(count - 1, 0) WHERE date = ?1 AND profile_id = ?2 AND service = ?3")
    .bind(usageDate(now), profileId, service)
    .run();
}

export const refundImageQuota = (DB: D1Database, profileId: string, now = new Date()) => refundQuota(DB, profileId, "image", now);
