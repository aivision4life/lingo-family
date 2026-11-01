import { describe, expect, it } from "vitest";
import { formatDueIn, hasSomethingToPractise } from "./dueIn";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const vi = (deltaMs: number) => formatDueIn(NOW + deltaMs, NOW, "vi");
const en = (deltaMs: number) => formatDueIn(NOW + deltaMs, NOW, "en");

describe("formatDueIn", () => {
  it("uses minutes within the hour", () => {
    expect(en(10 * 60_000)).toBe("in 10 minutes");
    expect(vi(10 * 60_000)).toContain("10");
  });

  it("switches to hours, then days, instead of counting thousands of minutes", () => {
    expect(en(3 * 3_600_000)).toBe("in 3 hours");
    expect(en(3 * 86_400_000)).toBe("in 3 days");
  });

  it("rounds to the nearest unit", () => {
    expect(en(89 * 60_000)).toBe("in 1 hour");
    expect(en(100 * 60_000)).toBe("in 2 hours");
  });

  it("says now for anything already due or due within the minute", () => {
    expect(en(-5 * 60_000)).toBe("now");
    expect(en(30_000)).toBe("now");
  });

  it("follows the given locale", () => {
    expect(formatDueIn(NOW + 2 * 3_600_000, NOW, "en")).toBe("in 2 hours");
    expect(formatDueIn(NOW + 2 * 3_600_000, NOW, "ko")).toBe("2시간 후");
  });
});

describe("hasSomethingToPractise", () => {
  it("counts both never-answered and due-again questions, the same two tiers a session uses", () => {
    expect(hasSomethingToPractise({ unseen: 0, due: 2 })).toBe(true);
    expect(hasSomethingToPractise({ unseen: 3, due: 0 })).toBe(true);
  });

  it("is false when everything has been answered and nothing is due — the empty-session case", () => {
    expect(hasSomethingToPractise({ unseen: 0, due: 0 })).toBe(false);
  });
});
