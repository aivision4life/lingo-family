import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests do not start the Cloudflare plugin.
//
// Two projects:
//  - "unit": pure tests (src, shared, scripts, benchmarks); many in parallel.
//  - "worker": tests that start Miniflare / workerd through wrangler's getPlatformProxy
//    (worker/**, db/**). Every such file starts its own workerd process with its own local ports;
//    starting many at once on Windows made some connections fail with `connect EADDRINUSE
//    127.0.0.1:<port>` (about 1 full run in 3), so only 2 of these files run at the same time.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@db": path.resolve(import.meta.dirname, "db"),
    },
  },
  test: {
    environment: "node",
    // API tests run many requests against a local D1 (workerd); a test can take more than the
    // default 5 s on a busy machine.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["{src,shared,benchmarks,scripts}/**/*.test.ts"], sequence: { groupOrder: 1 } },
      },
      {
        extends: true,
        // Different worker limits need different groups; the groups run one after the other.
        test: { name: "worker", include: ["{worker,db}/**/*.test.ts"], maxWorkers: 2, sequence: { groupOrder: 2 } },
      },
    ],
  },
});
