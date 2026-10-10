import { describe, expect, it } from "vitest";
import { parseAutoplay } from "./autoplay";

describe("parseAutoplay", () => {
  it("defaults to on; only an explicit 0 turns it off", () => {
    expect(parseAutoplay(null)).toBe(true);
    expect(parseAutoplay("1")).toBe(true);
    expect(parseAutoplay("")).toBe(true);
    expect(parseAutoplay("0")).toBe(false);
  });
});
