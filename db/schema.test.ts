import { getTableColumns } from "drizzle-orm";
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { cards, review_logs } from "./schema";

const columnNames = (table: Parameters<typeof getTableColumns>[0]) =>
  Object.values(getTableColumns(table)).map((c) => c.name);

describe("schema mirrors ts-fsrs", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const card = createEmptyCard(now);
  const { log } = fsrs().next(card, now, Rating.Good);

  it("cards has a column for every Card field", () => {
    // last_review is optional on an empty card, so add it explicitly.
    const fields = new Set([...Object.keys(card), "last_review"]);
    expect(columnNames(cards)).toEqual(expect.arrayContaining([...fields]));
  });

  it("review_logs has a column for every ReviewLog field", () => {
    // ReviewLog.review is stored as reviewed_at.
    const fields = Object.keys(log).map((k) => (k === "review" ? "reviewed_at" : k));
    expect(columnNames(review_logs)).toEqual(expect.arrayContaining(fields));
  });
});
