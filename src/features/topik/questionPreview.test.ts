import { describe, expect, it } from "vitest";
import { truncate } from "./questionPreview";

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("아침에 전화를 드렸다.", 40)).toBe("아침에 전화를 드렸다.");
  });

  it("cuts long text to the limit and adds an ellipsis", () => {
    const text = "가".repeat(50);
    const result = truncate(text, 40);
    expect(result).toBe(`${"가".repeat(40)}…`);
  });

  it("trims trailing whitespace left by the cut before adding the ellipsis", () => {
    const text = `${"가".repeat(39)} ${"나".repeat(10)}`;
    expect(truncate(text, 40)).toBe(`${"가".repeat(39)}…`);
  });

  it("trims surrounding whitespace on short text too", () => {
    expect(truncate("  hi  ", 40)).toBe("hi");
  });
});
