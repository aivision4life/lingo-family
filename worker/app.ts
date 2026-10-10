import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireAccess, type AccessVariables } from "./middleware/access";
import { debugLlmRoutes } from "./routes/debugLlm";
import { healthRoutes } from "./routes/health";
import { imageRoutes } from "./routes/images";
import { mediaRoutes } from "./routes/media";
import { phraseRoutes } from "./routes/phrases";
import { profileRoutes } from "./routes/profiles";
import { reviewRoutes } from "./routes/review";
import { defaultImageAi, wordRoutes, type MakeImageAi, type MakeLlm, type MakeTts } from "./routes/words";
import { createLlmClient } from "./services/llm";
import { createTtsClient } from "./services/tts";

export type AppDeps = {
  /** Access gate; tests inject a fake JWKS fetch. */
  access?: ReturnType<typeof requireAccess>;
  /** Build the paid-API clients from env; tests pass fakes. */
  makeLlm?: MakeLlm;
  makeTts?: MakeTts;
  /** Workers AI for images; tests pass a fake (or null = no drawing). */
  makeImageAi?: MakeImageAi;
};

// All API routes live under /api. Everything else is served from static assets (the SPA).
export function createApp({
  makeLlm = createLlmClient,
  makeTts = createTtsClient,
  makeImageAi = defaultImageAi,
  access = requireAccess(),
}: AppDeps = {}) {
  const deps = { makeLlm, makeTts, makeImageAi };
  const app = new Hono<{ Bindings: AppEnv["Bindings"]; Variables: AccessVariables }>().basePath("/api");

  // Fail-closed: nothing under /api runs before the Access JWT (and the email allow-list) is checked.
  app.use("*", access);

  app.route("/health", healthRoutes);
  app.route("/profiles", profileRoutes);
  app.route("/words", wordRoutes(deps));
  app.route("/", phraseRoutes(deps));
  app.route("/", imageRoutes(deps));
  app.route("/media", mediaRoutes);
  // TODO(M2.1): remove with worker/routes/debugLlm.ts once the production Gemini 400 is fixed.
  app.route("/debug", debugLlmRoutes);
  app.route("/review", reviewRoutes);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}
