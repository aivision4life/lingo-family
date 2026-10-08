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
    include: ["{src,worker,shared,db,benchmarks}/**/*.test.ts"],
    environment: "node",
    // API tests run many requests against a local D1 (workerd); with all files in parallel a
    // test can take more than the default 5 s on a busy machine.
    testTimeout: 20_000,
  },
});
