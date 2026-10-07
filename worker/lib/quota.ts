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
