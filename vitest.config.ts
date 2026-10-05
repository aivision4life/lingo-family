import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests do not start the Cloudflare plugin.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@db": path.resolve(import.meta.dirname, "db"),
    },
  },
  test: {
    include: ["{src,worker,shared,db}/**/*.test.ts"],
    environment: "node",
  },
});
