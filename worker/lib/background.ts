import type { Context } from "hono";
import type { AppEnv } from "../env";

/**
 * Runs `task` after the response with `waitUntil`. Cloudflare allows about 30 s of extra work
 * after the response; a job cut off there leaves its item `pending`, and a later request takes it
 * over once it is stale (see claimImage). Without an execution context (some tests) the task just
 * runs detached.
 */
export function runInBackground(c: Context<AppEnv>, task: Promise<unknown>) {
  const safe = task.catch((err: unknown) => console.error("Background task failed:", err));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    // No ExecutionContext available: the promise keeps running on its own.
  }
}
