import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev` removes the Workers AI binding: it is a remote binding, which needs a preview
// session on lingo.ai4life.workers.dev (behind Cloudflare Access → cloudflared login) and costs
// quota. Without it the Worker uses the fake image provider (worker/services/fakeImage.ts).
// `npm run dev:ai` (vite --mode ai) keeps the real binding. Builds and deploys are unaffected.
export default defineConfig(({ command, mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(
      command === "serve" && mode !== "ai"
        ? {
            config: (config) => {
              delete config.ai;
            },
          }
        : {},
    ),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@db": path.resolve(import.meta.dirname, "db"),
    },
  },
}));
