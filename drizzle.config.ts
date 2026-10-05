import { defineConfig } from "drizzle-kit";

// drizzle-kit only generates SQL files here; wrangler applies them to D1.
export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./db/migrations",
});
