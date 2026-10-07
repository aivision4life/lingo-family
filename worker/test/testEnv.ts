// Test helper: a real (in-memory) local D1 via wrangler's getPlatformProxy, with all
// migrations applied, plus a small request helper around the Hono app.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { createApp } from "../app";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../db/migrations");

/**
 * getPlatformProxy also loads .dev.vars (real API keys), so the default app has no LLM:
 * tests never call a paid API. Pass `createApp({ makeLlm })` with a fake to test AI routes.
 */
export async function createTestEnv(app = createApp({ makeLlm: () => null })) {
  const proxy: PlatformProxy<Env> = await getPlatformProxy<Env>({ persist: false });
  const env = proxy.env;

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) await env.DB.prepare(stmt).run();
    }
  }

  /** Calls the Worker app like a browser would: `api("POST", "/profiles", body)`. */
  const api = async (method: string, url: string, body?: unknown) => {
    const res = await app.request(
      `/api${url}`,
      {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as unknown };
  };

  return { env, api, dispose: () => proxy.dispose() };
}
