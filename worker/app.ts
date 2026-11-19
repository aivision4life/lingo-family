import { Hono } from "hono";
import type { AppEnv } from "./env";
import { isStaticFilePath } from "../shared/staticPath";
import { requireAccess, type AccessVariables } from "./middleware/access";
import { albumRoutes } from "./routes/albums";
import { customEnrichRoutes } from "./routes/customEnrich";
import { exampleRoutes } from "./routes/examples";
import { healthRoutes } from "./routes/health";
import { imageRoutes } from "./routes/images";
import { mediaRoutes } from "./routes/media";
import { phraseRoutes } from "./routes/phrases";
import { profileRoutes } from "./routes/profiles";
import { pronRoutes, type MakePron } from "./routes/pron";
import { reviewRoutes } from "./routes/review";
import { topikRoutes } from "./routes/topik";
import { topikPodcastRoutes } from "./routes/topikPodcast";
import { topikTestRoutes } from "./routes/topikTests";
import { defaultImageAi, wordRoutes, type MakeImageAi, type MakeLlm, type MakeTts } from "./routes/words";
import { createLlmClient } from "./services/llm";
import { createPronClient } from "./services/pronunciation";
import { createTtsClient } from "./services/tts";

export type AppDeps = {
  /** Access gate; tests inject a fake JWKS fetch. */
  access?: ReturnType<typeof requireAccess>;
  /** Build the paid-API clients from env; tests pass fakes. */
  makeLlm?: MakeLlm;
  makeTts?: MakeTts;
  /** Azure pronunciation scoring (M3); a paid call like the two above. */
  makePron?: MakePron;
  /** Workers AI for images; tests pass a fake (or null = no drawing). */
  makeImageAi?: MakeImageAi;
};

/**
 * The app's own routes end up here: a path with no file extension is a React Router route, so it
 * gets `index.html` and the router takes over in the browser. A path that looks like a file and
 * matched no asset gets a **real 404** — never index.html (M7.4).
 *
 * Why it matters: with `not_found_handling: "single-page-application"` the asset layer answered a
 * missing /assets/x.css with the HTML page. The service worker then stored, or tried to store, an
 * HTML document as a stylesheet, declared the response bad and failed to install — leaving a phone
 * on the previous build with no developer tools to escape with.
 *
 * The test is the shape of the path, never a list of folders or routes: a list has to be updated
 * every time a route or a kind of file is added, and the one time it is forgotten the app loses
 * navigation. Every route of this app has no extension by construction ("/topik/tests/:id",
 * "/words/new"), and every file has one.
 */
async function spaFallback(env: AppEnv["Bindings"], url: URL): Promise<Response> {
  const plain = { "content-type": "text/plain; charset=utf-8" };
  if (isStaticFilePath(url.pathname)) return new Response(`Not found: ${url.pathname}`, { status: 404, headers: plain });
  // No binding (local dev serves the SPA itself, tests have no assets): nothing to fall back to.
  if (!env.ASSETS) return new Response("Not found", { status: 404, headers: plain });

  const index = await env.ASSETS.fetch(new Request(new URL("/index.html", url.origin)));
  const headers = new Headers(index.headers);
  // The shell must never be held by a cache: it names this build's hashed CSS/JS, and a stale copy
  // is exactly how an old deploy comes back to life.
  headers.set("cache-control", "no-cache");
  return new Response(index.body, { status: index.status, headers });
}

// All API routes live under /api. Everything else is the SPA: assets first, then `spaFallback`.
export function createApp({
  makeLlm = createLlmClient,
  makeTts = createTtsClient,
  makePron = createPronClient,
  makeImageAi = defaultImageAi,
  access = requireAccess(),
}: AppDeps = {}) {
  const deps = { makeLlm, makeTts, makeImageAi };
  const api = new Hono<{ Bindings: AppEnv["Bindings"]; Variables: AccessVariables }>().basePath("/api");
  const app = api;

  // Fail-closed: nothing under /api runs before the Access JWT (and the email allow-list) is checked.
  app.use("*", access);

  app.route("/health", healthRoutes);
  app.route("/profiles", profileRoutes);
  app.route("/words", wordRoutes(deps));
  app.route("/", phraseRoutes(deps));
  app.route("/", imageRoutes(deps));
  app.route("/media", mediaRoutes);
  app.route("/review", reviewRoutes);
  app.route("/", albumRoutes);
  app.route("/enrich", customEnrichRoutes(deps));
  app.route("/", exampleRoutes(deps));
  app.route("/", topikRoutes(deps));
  app.route("/", topikTestRoutes());
  app.route("/", topikPodcastRoutes());
  app.route("/", pronRoutes({ makePron }));

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  // The API's own 404 stays JSON; everything outside /api is the SPA.
  const root = new Hono<{ Bindings: AppEnv["Bindings"]; Variables: AccessVariables }>();
  root.route("/", api);
  root.all("*", (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
    return spaFallback(c.env, url);
  });
  return root;
}
