import { describe, expect, it } from "vitest";
import { resolveNow } from "./devNow";

const real = new Date("2026-10-08T00:00:00Z");

describe("resolveNow", () => {
  it("ignores X-Dev-Now unless DEV_TIME_TRAVEL=1", () => {
    expect(resolveNow({}, "2026-12-01T00:00:00Z", real)).toBe(real);
    expect(resolveNow({ DEV_TIME_TRAVEL: "0" }, "2026-12-01T00:00:00Z", real)).toBe(real);
    expect(resolveNow({ DEV_TIME_TRAVEL: "true" }, "2026-12-01T00:00:00Z", real)).toBe(real);
  });

  it("uses a valid fake date when the flag is on", () => {
    expect(resolveNow({ DEV_TIME_TRAVEL: "1" }, "2026-12-01T00:00:00Z", real).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(resolveNow({ DEV_TIME_TRAVEL: "1" }, "not a date", real)).toBe(real);
    expect(resolveNow({ DEV_TIME_TRAVEL: "1" }, undefined, real)).toBe(real);
  });
});
