// Cloudflare Access gate for every /api request (fail-closed).
//
// Access puts a signed JWT in the `Cf-Access-Jwt-Assertion` header after the user logged in.
// We verify the signature against the team's public keys (JWKS), then `iss`, `aud` and `exp`,
// then check the email against ALLOWED_EMAILS. Anything missing or wrong → 401/403, so even
// when Access is not configured yet nobody can use the paid APIs.
import type { MiddlewareHandler } from "hono";
import { verifyWithJwks } from "hono/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/jws";
import { z } from "zod";
import { localFlag } from "../lib/localDev";

export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
const JWKS_TTL_MS = 10 * 60 * 1000;

const configSchema = z.object({
  ACCESS_TEAM_DOMAIN: z.string().trim().min(1),
  ACCESS_AUD: z.string().trim().min(1),
  ALLOWED_EMAILS: z.string().trim().min(1),
});

/** Authenticated user, available to routes as `c.get("userEmail")`. */
export type AccessVariables = { userEmail: string };

export const DEV_BYPASS_EMAIL = "dev@localhost";

export const parseAllowedEmails = (list: string) =>
  list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

type Options = { fetch?: typeof fetch; now?: () => number };

/** Creates the middleware; tests inject `fetch` (fake JWKS) and `now`. */
export function requireAccess(opts: Options = {}): MiddlewareHandler<{ Variables: AccessVariables }> {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  // Keys are cached per isolate; unknown `kid` (key rotation) forces one refresh.
  let cache: { domain: string; keys: HonoJsonWebKey[]; at: number } | null = null;

  async function keysFor(domain: string, forceRefresh: boolean) {
    if (cache && cache.domain === domain && !forceRefresh && now() - cache.at < JWKS_TTL_MS) return cache.keys;
    const res = await doFetch(`https://${domain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys?: HonoJsonWebKey[] };
    if (!Array.isArray(body.keys)) throw new Error("invalid JWKS");
    cache = { domain, keys: body.keys, at: now() };
    return cache.keys;
  }

  return async (c, next) => {
    // Local development only: no Access in front of `npm run dev`.
    if (localFlag(c.env, "DEV_AUTH_BYPASS", c.req.url)) {
      c.set("userEmail", DEV_BYPASS_EMAIL);
      return next();
    }

    const deny = (status: 401 | 403) => c.json({ error: status === 401 ? "unauthorized" : "forbidden" }, status);

    const config = configSchema.safeParse(c.env);
    const token = c.req.header(ACCESS_JWT_HEADER);
    if (!config.success || !token) return deny(401);
    const { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: aud, ALLOWED_EMAILS } = config.data;

    let payload;
    try {
      const verify = async (refresh: boolean) =>
        verifyWithJwks(token, { keys: await keysFor(domain, refresh), allowedAlgorithms: ["RS256"] });
      payload = await verify(false).catch(() => verify(true));
    } catch {
      return deny(401);
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== `https://${domain}` || !audiences.includes(aud)) return deny(401);

    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email || !parseAllowedEmails(ALLOWED_EMAILS).includes(email)) return deny(403);

    c.set("userEmail", email);
    return next();
  };
}
