import { Hono } from "hono";
import type { AppEnv } from "./env";
import { healthRoutes } from "./routes/health";
import { profileRoutes } from "./routes/profiles";

// All API routes live under /api. Everything else is served from static assets (the SPA).
const app = new Hono<AppEnv>().basePath("/api");

app.route("/health", healthRoutes);
app.route("/profiles", profileRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
