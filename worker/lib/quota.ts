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
 * Image quota, two tiers (SPEC F3): at most `perProfile` images for this profile **and** at most
 * `familyCap` images for all profiles together today. One atomic statement, so two parallel
 * requests can never both take the last unit. Returns false (and counts nothing) when either
 * limit is reached.
 */
export async function consumeImageQuota(
  DB: D1Database,
  profileId: string,
  perProfile: number,
  familyCap: number,
  now = new Date(),
): Promise<boolean> {
  const date = usageDate(now);
  const familyUsed = "(SELECT coalesce(sum(count), 0) FROM usage_daily WHERE date = ?1 AND service = 'image')";
  const row = await DB.prepare(
    `INSERT INTO usage_daily (date, profile_id, service, count)
       SELECT ?1, ?2, 'image', 1 WHERE ${familyUsed} < ?4
     ON CONFLICT (date, profile_id, service) DO UPDATE SET count = count + 1
       WHERE count < ?3 AND ${familyUsed} < ?4
     RETURNING count`,
  )
    .bind(date, profileId, perProfile, familyCap)
    .first<{ count: number }>();
  return row !== null;
}

/**
 * Gives back one unit of today's image quota for `profileId` (M2.9): a drawing was attempted and
 * failed, so in the end it should not count against the daily limit. Never goes below 0; does
 * nothing if there is no row yet (nothing was ever consumed for this profile today).
 */
export async function refundImageQuota(DB: D1Database, profileId: string, now = new Date()): Promise<void> {
  await DB.prepare("UPDATE usage_daily SET count = max(count - 1, 0) WHERE date = ?1 AND profile_id = ?2 AND service = 'image'")
    .bind(usageDate(now), profileId)
    .run();
}
