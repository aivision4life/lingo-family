import { Rating, State } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import type { CardDto, QueueItem } from "@shared/review";
import { applyReview, emptyCardFields, type CardFields } from "@shared/scheduling";
import { intervalLabel } from "./formatInterval";
import { afterAnswer, currentItem, flip, isFinished, startSession } from "./session";

const now = new Date("2026-10-08T03:00:00Z");

const dto = (id: string, f: CardFields): CardDto => ({
  ...f,
  id,
  card_type: "recognition",
  due: f.due.getTime(),
  last_review: f.last_review?.getTime() ?? null,
});

const item = (id: string): QueueItem => ({
  card: dto(id, emptyCardFields(now)),
  word: {
    kind: "word",
    id: `w-${id}`,
    word_id: `w-${id}`,
    root_term: null,
    lang: "ko",
    term: id,
    reading: id,
    gloss_vi: "",
    gloss_en: "",
    gloss_ko: "",
    emoji: null,
    hanja: null,
    han_viet: null,
    audio_key: null,
  },
});

describe("review session", () => {
  it("flips, then moves to the next card after an answer", () => {
    let s = startSession([item("a"), item("b")]);
    s = flip(s);
    expect(s.flipped).toBe(true);
    const easy = applyReview(emptyCardFields(now), Rating.Easy, now).card; // → Review, days away
    s = afterAnswer(s, dto("a", easy), now);
    expect(currentItem(s)?.card.id).toBe("b");
    expect(s).toMatchObject({ flipped: false, answered: 1 });
  });

  it("re-queues a card answered Again (due again within the session)", () => {
    let s = startSession([item("a"), item("b")]);
    const again = applyReview(emptyCardFields(now), Rating.Again, now).card;
    expect(again.state).toBe(State.Learning);
    s = afterAnswer(s, dto("a", again), now);
    expect(s.queue.map((i) => i.card.id)).toEqual(["a", "b", "a"]);
    expect(s.queue[2]!.card.reps).toBe(1); // carries the updated card for the next preview
  });

  it("finishes when every card is done", () => {
    let s = startSession([item("a")]);
    s = afterAnswer(s, dto("a", applyReview(emptyCardFields(now), Rating.Easy, now).card), now);
    expect(isFinished(s)).toBe(true);
    expect(currentItem(s)).toBeNull();
  });
});

describe("intervalLabel", () => {
  it.each([
    [30_000, "lessThanMinute", 0],
    [60_000, "minutes", 1],
    [10 * 60_000, "minutes", 10],
    [5 * 3_600_000, "hours", 5],
    [3 * 86_400_000, "days", 3],
    [90 * 86_400_000, "months", 3],
    [730 * 86_400_000, "years", 2],
  ] as const)("%d ms → %s %d", (ms, key, count) => {
    expect(intervalLabel(ms)).toEqual({ key, count });
  });
});
