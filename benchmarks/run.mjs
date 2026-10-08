// Runs a TypeScript benchmark through Vite's module runner (no extra TS runner dependency).
// Usage: node benchmarks/run.mjs <file.ts> [args...]
import { runnerImport } from "vite";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node benchmarks/run.mjs <file.ts> [args...]");
  process.exit(1);
}
await runnerImport(file, { configFile: false, logLevel: "warn" });
