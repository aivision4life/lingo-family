import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// `npm run dev` removes the Workers AI binding: it is a remote binding, which needs a preview
// session on lingo.ai4life.workers.dev (behind Cloudflare Access → cloudflared login) and costs
// quota. Without it the Worker uses the fake image provider (worker/services/fakeImage.ts).
// `npm run dev:ai` (vite --mode ai) keeps the real binding. `npm run preview` builds with
// `--mode preview` (production bundle incl. service worker, but without the AI binding) so the
// production build can be tried locally. A normal `vite build` (npm run build / deploy) keeps
// the binding.
export default defineConfig(({ command, mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(
      (command === "serve" && mode !== "ai") || mode === "preview"
        ? {
            config: (config) => {
              delete config.ai;
            },
          }
        : {},
    ),
    // PWA: manifest + service worker (src/sw.ts). The worker is built only for `vite build`; the
    // dev server never registers one, so `npm run dev` is unaffected.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt", // the app shows "new version — Reload" (src/features/pwa)
      injectRegister: false, // registered by src/features/pwa/UpdateBanner.tsx
      // The site is behind Cloudflare Access: the manifest request must carry the session cookie,
      // otherwise Access answers it with a login redirect and the manifest is lost.
      useCredentials: true,
      includeAssets: ["favicon.svg", "icons/*.png", "icons/icon.svg"],
      manifest: {
        id: "/",
        name: "Lingo Family",
        short_name: "Lingo",
        description: "Family vocabulary learning: Korean and English, with pictures and audio.",
        lang: "vi",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#4f46e5",
        background_color: "#ffffff",
        categories: ["education"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        // App shell only. The Noto Sans KR pieces (~500 files) are cached when first used.
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        globIgnores: ["**/*.woff", "**/*.woff2"],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@db": path.resolve(import.meta.dirname, "db"),
    },
  },
}));
