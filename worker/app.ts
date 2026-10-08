import { Hono } from "hono";
import type { AppEnv } from "./env";
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
}: AppDeps = {}) {
  const deps = { makeLlm, makeTts, makeImageAi };
  const app = new Hono<AppEnv>().basePath("/api");

  app.route("/health", healthRoutes);
  app.route("/profiles", profileRoutes);
  app.route("/words", wordRoutes(deps));
  app.route("/", phraseRoutes(deps));
  app.route("/", imageRoutes(deps));
  app.route("/media", mediaRoutes);
  app.route("/review", reviewRoutes);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}
