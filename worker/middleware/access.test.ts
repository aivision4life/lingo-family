import { sign } from "hono/jwt";
import { beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test/testEnv";
import { requireAccess } from "./access";

const DOMAIN = "ai4life.cloudflareaccess.com";
const AUD = "test-aud-tag";
const PROD = "https://lingo-family.ai4life.workers.dev";
// A path that needs no D1/R2: when the gate lets the request through, the app answers 404.
const OPEN_PATH = "/api/nope";
const PASSED = 404;
const NOW_S = Math.floor(Date.now() / 1000);

type Jwk = JsonWebKey & { kid: string; alg: string };
let privateJwk: Jwk;
let otherPrivateJwk: Jwk;
let publicJwk: JsonWebKey;
let fetchCalls = 0;

async function makeKeys(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return {
    priv: { ...((await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey), kid, alg: "RS256" } as Jwk,
    pub: { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid, alg: "RS256" },
  };
}

beforeAll(async () => {
  const a = await makeKeys("key-1");
  privateJwk = a.priv;
  publicJwk = a.pub;
  otherPrivateJwk = (await makeKeys("key-1")).priv; // same kid, different key → bad signature
});

const claims = (over: Record<string, unknown> = {}) => ({
  iss: `https://${DOMAIN}`,
  aud: [AUD],
  email: "Dad@Example.com",
  iat: NOW_S - 10,
  nbf: NOW_S - 10,
  exp: NOW_S + 3600,
  ...over,
});
const token = (over: Record<string, unknown> = {}, key: Jwk = privateJwk) => sign(claims(over), key);

/** App with the real access middleware but a fake JWKS endpoint. */
const makeApp = () => {
  fetchCalls = 0;
  const fakeFetch = (async (url: string | URL | Request) => {
    fetchCalls++;
    expect(String(url)).toBe(`https://${DOMAIN}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  }) as typeof fetch;
  return testApp({ access: requireAccess({ fetch: fakeFetch }) });
};

const config = { ACCESS_TEAM_DOMAIN: DOMAIN, ACCESS_AUD: AUD, ALLOWED_EMAILS: "dad@example.com, Mom@Example.com" };
const call = (app: ReturnType<typeof makeApp>, env: Record<string, string>, jwt?: string, base = PROD, path = OPEN_PATH) =>
  app.request(base + path, { headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {} }, env);

describe("requireAccess (production host)", () => {
  it("accepts a valid JWT of an allowed email (case-insensitive)", async () => {
    const res = await call(makeApp(), config, await token());
    expect(res.status).toBe(PASSED);
  });

  it("puts the verified email in the context", async () => {
    const { Hono } = await import("hono");
    const app = new Hono<{ Variables: { userEmail: string } }>();
    app.use("*", requireAccess({ fetch: (async () => new Response(JSON.stringify({ keys: [publicJwk] }))) as typeof fetch }));
    app.get("/who", (c) => c.text(c.get("userEmail")));
    const res = await app.request(`${PROD}/who`, { headers: { "Cf-Access-Jwt-Assertion": await token() } }, config);
    expect(await res.text()).toBe("dad@example.com");
  });

  it("protects every /api route, including /api/health, and unknown paths", async () => {
    const app = makeApp();
    for (const path of ["/api/health", "/api/profiles", "/api/words", "/api/media/audio/x.mp3", "/api/nope", "/api/review/queue"]) {
      expect((await call(app, config, undefined, PROD, path)).status, path).toBe(401);
    }
  });

  it("401 for a missing, malformed, wrongly signed, expired or wrong-aud/iss token", async () => {
    const app = makeApp();
    const cases: [string, string | undefined][] = [
      ["missing", undefined],
      ["malformed", "not.a.jwt"],
      ["bad signature", await token({}, otherPrivateJwk)],
      ["expired", await token({ exp: NOW_S - 60 })],
      ["wrong aud", await token({ aud: ["someone-else"] })],
      ["wrong iss", await token({ iss: "https://evil.cloudflareaccess.com" })],
    ];
    for (const [name, jwt] of cases) expect((await call(app, config, jwt)).status, name).toBe(401);
  });

  it("403 when the email is not allowed or missing from the token", async () => {
    const app = makeApp();
    expect((await call(app, config, await token({ email: "stranger@example.com" }))).status).toBe(403);
    expect((await call(app, config, await token({ email: undefined }))).status).toBe(403);
  });

  it("fail-closed: missing ACCESS_AUD, ACCESS_TEAM_DOMAIN or ALLOWED_EMAILS → 401 even with a valid JWT", async () => {
    const app = makeApp();
    const jwt = await token();
    for (const missing of ["ACCESS_AUD", "ACCESS_TEAM_DOMAIN", "ALLOWED_EMAILS"] as const) {
      const rest: Record<string, string> = { ...config };
      delete rest[missing];
      expect((await call(app, rest, jwt)).status, missing).toBe(401);
      expect((await call(app, { ...rest, [missing]: "  " }, jwt)).status, `${missing} blank`).toBe(401);
    }
  });

  it("caches the JWKS between requests", async () => {
    const app = makeApp();
    await call(app, config, await token());
    await call(app, config, await token());
    expect(fetchCalls).toBe(1);
  });

  it("DEV_AUTH_BYPASS has no effect on the production host", async () => {
    const res = await call(makeApp(), { ...config, DEV_AUTH_BYPASS: "1" });
    expect(res.status).toBe(401);
    const spoof = await makeApp().request(
      `${PROD}/api/health`,
      { headers: { Host: "localhost" } },
      { ...config, DEV_AUTH_BYPASS: "1" },
    );
    expect(spoof.status).toBe(401);
    const lookalike = await call(makeApp(), { DEV_AUTH_BYPASS: "1" }, undefined, "https://localhost.evil.com");
    expect(lookalike.status).toBe(401);
  });
});

describe("requireAccess (local development)", () => {
  it("DEV_AUTH_BYPASS=1 on localhost skips Access; without the flag localhost is also protected", async () => {
    const app = makeApp();
    expect((await call(app, { DEV_AUTH_BYPASS: "1" }, undefined, "http://localhost:5173")).status).toBe(PASSED);
    expect((await call(app, { DEV_AUTH_BYPASS: "1" }, undefined, "http://127.0.0.1:8787")).status).toBe(PASSED);
    expect((await call(app, {}, undefined, "http://localhost:5173")).status).toBe(401);
    expect((await call(app, { DEV_AUTH_BYPASS: "0" }, undefined, "http://localhost:5173")).status).toBe(401);
  });
});
