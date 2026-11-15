import { describe, expect, it } from "vitest";
import { CHUNK_RELOAD_WINDOW_MS, isChunkLoadError, shouldReloadForChunk } from "./importChunk";

describe("isChunkLoadError", () => {
  it.each([
    ["Chrome", "Failed to fetch dynamically imported module: https://lingo.ai4life.workers.dev/assets/TopikManagePage-abc.js"],
    ["Firefox", "error loading dynamically imported module"],
    ["Safari", "Importing a module script failed."],
    ["no network, no cache", "Failed to fetch"],
  ])("recognises %s's wording", (_, message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it("leaves an error thrown by the module's own code alone, because a reload cannot fix it", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of null (reading 'useState')"))).toBe(false);
  });

  it("copes with something thrown that is not an Error at all", () => {
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(true);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("shouldReloadForChunk", () => {
  const now = 1_700_000_000_000;

  it("reloads when nothing has been tried yet", () => {
    expect(shouldReloadForChunk(null, now)).toBe(true);
  });

  it("does not reload again right after a reload that did not help", () => {
    expect(shouldReloadForChunk(String(now - 1_000), now)).toBe(false);
  });

  it("reloads again for a failure long after the last one: that is a new problem", () => {
    expect(shouldReloadForChunk(String(now - CHUNK_RELOAD_WINDOW_MS - 1), now)).toBe(true);
  });

  it("treats an unreadable mark as no mark", () => {
    expect(shouldReloadForChunk("", now)).toBe(true);
    expect(shouldReloadForChunk("yesterday", now)).toBe(true);
  });
});
