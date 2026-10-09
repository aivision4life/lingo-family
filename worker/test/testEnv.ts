// Test helper: a real (in-memory) local D1 via wrangler's getPlatformProxy, with all
// migrations applied, plus a small request helper around the Hono app.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { createApp, type AppDeps } from "../app";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../db/migrations");

/**
 * App for tests. getPlatformProxy also loads .dev.vars (real API keys), so paid clients are
 * disabled unless a test passes a fake: tests must never call a paid API.
 */
export const testApp = (deps: AppDeps = {}) =>
  createApp({ makeLlm: () => null, makeTts: () => null, makeImageAi: () => null, ...deps });

/**
 * `vars` override env values from .dev.vars so tests do not depend on the developer's local
 * settings (e.g. DEV_TIME_TRAVEL is off unless a test turns it on). Tests run at http://localhost,
 * so DEV_AUTH_BYPASS=1 lets them skip Access; access.test.ts turns it off to test the gate.
 */
export async function createTestEnv(app = testApp(), vars: Record<string, string> = {}) {
  const proxy: PlatformProxy<Env> = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  // Bindings on proxy.env are not enumerable, so inherit them instead of copying them.
  const env: Env = Object.assign(Object.create(proxy.env) as Env, { DEV_TIME_TRAVEL: "0", DEV_AUTH_BYPASS: "1" }, vars);

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) await env.DB.prepare(stmt).run();
    }
  }

  // waitUntil() work (e.g. images drawn after saving) is collected; `settle()` waits for it.
  const background: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void background.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const settle = async () => {
    while (background.length > 0) await Promise.allSettled(background.splice(0));
  };

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
      ctx,
    );
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as unknown };
  };

  /** Raw GET returning the Response (for headers / binary bodies). */
  const raw = (url: string, headers: Record<string, string> = {}) => app.request(url, { headers }, env, ctx);

  /** Any request with a raw body (e.g. an image upload). */
  const send = (url: string, init: RequestInit) => app.request(url, init, env, ctx);

  return { env, api, raw, send, settle, dispose: () => proxy.dispose() };
}
