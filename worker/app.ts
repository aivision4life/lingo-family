import { Hono } from "hono";
import type { AppEnv } from "./env";
import { healthRoutes } from "./routes/health";
import { profileRoutes } from "./routes/profiles";
import { wordRoutes, type MakeLlm } from "./routes/words";
import { createLlmClient } from "./services/llm";

export type AppDeps = {
  /** Builds the LLM client from env; tests pass a fake. */
  makeLlm?: MakeLlm;
};

// All API routes live under /api. Everything else is served from static assets (the SPA).
export function createApp({ makeLlm = createLlmClient }: AppDeps = {}) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.route("/health", healthRoutes);
  app.route("/profiles", profileRoutes);
  app.route("/words", wordRoutes(makeLlm));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}
