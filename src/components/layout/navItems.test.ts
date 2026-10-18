import { describe, expect, it } from "vitest";
import { NAV_ITEMS, visibleNavItems } from "./navItems";

describe("visibleNavItems", () => {
  it("gives an adult every item, in the fixed order", () => {
    expect(visibleNavItems(false).map((i) => i.to)).toEqual(["/home", "/review", "/topik", "/words", "/settings"]);
  });

  // TOPIK II is for advanced learners and its practice sessions call the LLM, which kid profiles
  // never do; the route itself turns kids away too, so hiding it here is not the only guard.
  it("hides TOPIK from a kid profile and keeps the rest", () => {
    expect(visibleNavItems(true).map((i) => i.to)).toEqual(["/home", "/review", "/words", "/settings"]);
  });

  it("marks exactly the items that are adult-only", () => {
    expect(NAV_ITEMS.filter((i) => i.adultOnly).map((i) => i.to)).toEqual(["/topik"]);
  });
});
