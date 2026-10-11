import { describe, expect, it } from "vitest";
import { nextUtcMidnight } from "./quotaReset";

describe("nextUtcMidnight", () => {
  it("is the following UTC midnight, for any time of day", () => {
    expect(nextUtcMidnight(new Date("2026-10-11T00:00:00.001Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-10-11T13:45:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-10-11T23:59:59Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("exactly at UTC midnight, the next reset is a full day later (not the same instant)", () => {
    expect(nextUtcMidnight(new Date("2026-10-11T00:00:00.000Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("crosses month and year boundaries correctly", () => {
    expect(nextUtcMidnight(new Date("2026-10-31T10:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-12-31T23:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
