import { describe, expect, it } from "vitest";
import { canAddWords, showAddWordButton, showAddWordFab } from "./addWordVisibility";

const adult = { is_kid: false };
const kid = { is_kid: true };

describe("add word shortcuts", () => {
  it("only adult profiles can add words", () => {
    expect(canAddWords(adult)).toBe(true);
    expect(canAddWords(kid)).toBe(false);
    expect(canAddWords(null)).toBe(false);
    expect(canAddWords(undefined)).toBe(false);
  });

  it("the floating + shows on Home and the Library for adults", () => {
    expect(showAddWordFab(adult, "/home")).toBe(true);
    expect(showAddWordFab(adult, "/words")).toBe(true);
    expect(showAddWordFab(adult, "/words/")).toBe(true);
  });

  it("not on other screens (review, settings, the add form, word detail) and never for kids or without a profile", () => {
    for (const path of ["/review", "/settings", "/words/new", "/words/123", "/profiles", "/"]) {
      expect(showAddWordFab(adult, path), path).toBe(false);
    }
    expect(showAddWordFab(kid, "/home")).toBe(false);
    expect(showAddWordFab(kid, "/words")).toBe(false);
    expect(showAddWordFab(null, "/words")).toBe(false);
  });

  it("the Library header button is always available to adults, whatever the screen size", () => {
    expect(showAddWordButton(adult)).toBe(true);
    expect(showAddWordButton(kid)).toBe(false);
  });
});
