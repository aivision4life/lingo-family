import { describe, expect, it } from "vitest";
import { DEFAULT_SCOPE, isLibraryScope, parseScope } from "./libraryScope";

describe("isLibraryScope", () => {
  it("accepts only the three known values", () => {
    expect(isLibraryScope("learning")).toBe(true);
    expect(isLibraryScope("mine")).toBe(true);
    expect(isLibraryScope("all")).toBe(true);
    expect(isLibraryScope("other")).toBe(false);
    expect(isLibraryScope(null)).toBe(false);
  });
});

describe("parseScope", () => {
  it("defaults to 'learning' for null or a corrupted value", () => {
    expect(parseScope(null)).toBe(DEFAULT_SCOPE);
    expect(parseScope("garbage")).toBe(DEFAULT_SCOPE);
  });

  it("keeps a known value", () => {
    expect(parseScope("mine")).toBe("mine");
    expect(parseScope("all")).toBe("all");
  });
});
