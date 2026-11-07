import { describe, expect, it } from "vitest";
import { isInLastMinutes, READING_WARNING_MS } from "./readingClock";

// The length arithmetic itself is tested in `shared/topikClock.test.ts`, where it now lives: the
// server sets a paper's deadline with the same function.
describe("isInLastMinutes", () => {
  it("warns inside the last few minutes", () => {
    expect(isInLastMinutes(READING_WARNING_MS)).toBe(true);
    expect(isInLastMinutes(60_000)).toBe(true);
  });

  it("does not warn with time to spare, nor once the time is gone", () => {
    expect(isInLastMinutes(READING_WARNING_MS + 1)).toBe(false);
    expect(isInLastMinutes(0)).toBe(false);
  });
});
