import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import ko from "./locales/ko.json";
import vi from "./locales/vi.json";

/** Flattens nested JSON into [dot.path, value] pairs sorted by path. */
function leaves(obj: unknown, prefix = ""): [string, unknown][] {
  if (typeof obj !== "object" || obj === null) return [[prefix, obj]];
  return Object.entries(obj)
    .flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
    .sort(([a], [b]) => a.localeCompare(b));
}

const keys = (obj: unknown) => leaves(obj).map(([path]) => path);

/** {{placeholders}} per key, so translations keep the same interpolation variables. */
const placeholders = (obj: unknown) =>
  leaves(obj).map(([path, value]) => [path, String(value).match(/{{\s*\w+\s*}}/g)?.sort() ?? []]);

const others = [
  ["ko", ko],
  ["en", en],
] as const;
const all = [["vi", vi], ...others] as const;

describe("locales", () => {
  it.each(others)("%s has exactly the same keys as vi", (_, locale) => {
    expect(keys(locale)).toEqual(keys(vi));
  });

  it.each(others)("%s uses the same {{placeholders}} as vi", (_, locale) => {
    expect(placeholders(locale)).toEqual(placeholders(vi));
  });

  it.each(all)("%s has only non-empty string values", (_, locale) => {
    const bad = leaves(locale).filter(([, v]) => typeof v !== "string" || v.trim() === "");
    expect(bad).toEqual([]);
  });
});
