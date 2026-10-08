import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { WORD_ERRORS } from "../../shared/word";
import { profiles } from "../../db/schema";
import { getDb, type AppEnv } from "../env";

/**
 * Only existing adult profiles may add/edit/delete content or use AI (SPEC: kid restrictions).
 * Returns an error response to send, or null when the profile may continue.
 */
export async function requireAdult(c: Context<AppEnv>, profileId: string) {
  const p = await getDb(c.env).select({ is_kid: profiles.is_kid }).from(profiles).where(eq(profiles.id, profileId)).get();
  if (!p) return c.json({ error: "not_found" }, 404);
  if (p.is_kid) return c.json({ error: WORD_ERRORS.kidForbidden }, 403);
  return null;
}
