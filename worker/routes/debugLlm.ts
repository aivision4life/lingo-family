// TEMPORARY diagnostics for "Gemini HTTP 400 with an empty body" in production.
// TODO(M2.1): delete this file, its test and the `/debug` route in worker/app.ts once the Gemini
// problem is fixed.
//
// GET /api/debug/llm?profile_id=<adult profile id>
// Sits behind requireAccess like every /api route and is limited to adult profiles. It never
// returns the API key or any part of it (only its length and a "has odd characters" flag).
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { profiles } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const BODY_MAX = 300;

type Probe =
  | { status: number; headers: Record<string, string>; body: string }
  | { exception: { name: string; message: string } };

/** One request; reports status, all response headers and the first 300 characters of the body. */
async function probe(url: string, key: string, init: { method: string; body?: string }): Promise<Probe> {
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: { "x-goog-api-key": key, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text().catch((e: unknown) => `(body unreadable: ${String(e)})`);
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text.slice(0, BODY_MAX) };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    // The message could echo a URL; the key is only ever in a header, never in the URL.
    return { exception: { name: err.name, message: err.message.slice(0, BODY_MAX) } };
  }
}

/**
 * Where outgoing requests really leave from: Cloudflare's trace endpoint answers with the data
 * center (`colo`) and country (`loc`) that served this subrequest. With Placement configured this
 * is the placed location, which can differ from `request.cf.colo` (where the user entered).
 */
async function egressLocation() {
  try {
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(10_000) });
    const fields = Object.fromEntries(
      (await res.text())
        .split(/\r?\n/)
        .map((l) => l.split("=") as [string, string | undefined])
        .filter(([, v]) => v !== undefined),
    );
    return { colo: fields.colo ?? null, loc: fields.loc ?? null };
  } catch (e) {
    return { error: e instanceof Error ? e.name : "error" };
  }
}

export const debugLlmRoutes = new Hono<AppEnv>().get("/llm", async (c) => {
  const profileId = c.req.query("profile_id");
  if (!profileId) {
    const adults = await getDb(c.env).select({ id: profiles.id, name: profiles.name }).from(profiles).where(eq(profiles.is_kid, false));
    return c.json({ error: "profile_id_required", hint: "add ?profile_id=<id>", adult_profiles: adults }, 400);
  }
  const denied = await requireAdult(c, profileId);
  if (denied) return denied;

  const env = c.env as unknown as Record<string, unknown>;
  const rawKey = typeof env.LLM_API_KEY === "string" ? env.LLM_API_KEY : "";
  const rawModel = typeof env.LLM_MODEL === "string" ? env.LLM_MODEL : "";
  const key = rawKey.trim();
  const model = rawModel.trim() || "gemini-3.8-flash";

  const cf = (c.req.raw as Request & { cf?: { colo?: string; country?: string } }).cf;
  const key_info = {
    raw_length: rawKey.length,
    trimmed_length: key.length,
    // Anything other than printable ASCII (space and control characters included) in the raw value.
    has_non_printable_ascii: /[^\x21-\x7e]/.test(rawKey),
    has_non_printable_ascii_after_trim: /[^\x21-\x7e]/.test(key),
  };

  const models = key ? await probe(`${BASE}/models`, key, { method: "GET" }) : null;
  const generate = key
    ? await probe(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, key, {
        method: "POST",
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Say hi" }] }] }),
      })
    : null;

  return c.json({
    // Where the user's request entered Cloudflare.
    colo: cf?.colo ?? null,
    country: cf?.country ?? null,
    // Where this Worker's own requests (e.g. to Gemini) leave from; this is what Gemini sees.
    egress: await egressLocation(),
    model: { raw_length: rawModel.length, trimmed: model, trimmed_length: model.length },
    key: key_info,
    list_models: models ?? "skipped: no LLM_API_KEY",
    generate_content: generate ?? "skipped: no LLM_API_KEY",
  });
});
