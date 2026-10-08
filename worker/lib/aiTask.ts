import type { Context } from "hono";
import { LLM_DAILY_QUOTA, WORD_ERRORS } from "../../shared/word";
import { getDb, type AppEnv } from "../env";
import { LlmError } from "../services/llm";
import { consumeQuota } from "./quota";

class QuotaExceeded extends Error {}

const LLM_ERROR_STATUS = { not_configured: 503, unavailable: 502, invalid_output: 502 } as const;
const LLM_ERROR_CODE = {
  not_configured: WORD_ERRORS.aiNotConfigured,
  unavailable: WORD_ERRORS.aiUnavailable,
  invalid_output: WORD_ERRORS.aiInvalidOutput,
} as const;

/**
 * Runs a cache-first LLM task for a profile: the daily LLM quota is consumed only on a cache
 * miss (via `beforeLlmCall`), and LLM / quota errors become the API's error responses.
 */
export async function runAiTask<T>(
  c: Context<AppEnv>,
  profileId: string,
  task: (beforeLlmCall: () => Promise<void>) => Promise<T>,
) {
  const db = getDb(c.env);
  try {
    const result = await task(async () => {
      if (!(await consumeQuota(db, profileId, "llm", LLM_DAILY_QUOTA))) throw new QuotaExceeded();
    });
    return { ok: true as const, result };
  } catch (e) {
    if (e instanceof QuotaExceeded) return { ok: false as const, response: c.json({ error: WORD_ERRORS.quotaExceeded }, 429) };
    if (e instanceof LlmError) {
      console.error("AI task failed:", e.message);
      return { ok: false as const, response: c.json({ error: LLM_ERROR_CODE[e.code] }, LLM_ERROR_STATUS[e.code]) };
    }
    throw e;
  }
}
