import { Hono } from "hono";
import type { HealthResponse } from "../../shared/api/health";
import { profiles } from "../../db/schema";
import { getDb, type AppEnv } from "../env";

/** GET /api/health — confirms the Worker runs and D1 has the schema applied. */
export const healthRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const profileCount = await getDb(c.env).$count(profiles);
  return c.json({ ok: true, profileCount } satisfies HealthResponse);
});
