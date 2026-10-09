import { describe, expect, it } from "vitest";
import { resolveNow } from "./devNow";

const real = new Date("2026-10-08T00:00:00Z");
const LOCAL = "http://localhost:5173/api/review/queue";
const PROD = "https://lingo.ai4life.workers.dev/api/review/queue";

describe("resolveNow", () => {
  it("ignores X-Dev-Now unless DEV_TIME_TRAVEL=1", () => {
    expect(resolveNow({}, "2026-12-01T00:00:00Z", LOCAL, real)).toBe(real);
    expect(resolveNow({ DEV_TIME_TRAVEL: "0" }, "2026-12-01T00:00:00Z", LOCAL, real)).toBe(real);
    expect(resolveNow({ DEV_TIME_TRAVEL: "true" }, "2026-12-01T00:00:00Z", LOCAL, real)).toBe(real);
  });

  it("uses a valid fake date when the flag is on", () => {
    expect(resolveNow({ DEV_TIME_TRAVEL: "1" }, "2026-12-01T00:00:00Z", LOCAL, real).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(resolveNow({ DEV_TIME_TRAVEL: "1" }, "not a date", LOCAL, real)).toBe(real);
    expect(resolveNow({ DEV_TIME_TRAVEL: "1" }, undefined, LOCAL, real)).toBe(real);
  });

  it("ignores X-Dev-Now on a non-local host even when DEV_TIME_TRAVEL=1", () => {
    expect(resolveNow({ DEV_TIME_TRAVEL: "1" }, "2026-12-01T00:00:00Z", PROD, real)).toBe(real);
    expect(resolveNow({ DEV_TIME_TRAVEL: "1" }, "2026-12-01T00:00:00Z", "https://localhost.evil.com/api", real)).toBe(real);
  });
});
