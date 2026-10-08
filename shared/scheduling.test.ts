import { Rating, State } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import {
  applyReview,
  buildQueue,
  emptyCardFields,
  localDayStart,
  previewIntervals,
  repeatsInSession,
  type QueueCandidate,
} from "./scheduling";

const now = new Date("2026-10-08T03:00:00Z"); // 12:00 in Korea (UTC+9)
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe("applyReview", () => {
  it("returns the new card and a complete log of the state before the review", () => {
    const before = emptyCardFields(now);
    const { card, log } = applyReview(before, Rating.Good, now);
    expect(card.state).toBe(State.Learning);
    expect(card.reps).toBe(1);
    expect(card.last_review).toEqual(now);
    expect(log).toMatchObject({ rating: Rating.Good, state: State.New, reviewed_at: now });
    expect(Object.keys(log).sort()).toEqual(
      ["difficulty", "due", "elapsed_days", "last_elapsed_days", "learning_steps", "rating", "reviewed_at", "scheduled_days", "stability", "state"].sort(),
    );
  });

  it("Again on a review card is a lapse and goes to relearning", () => {
    let card = emptyCardFields(now);
    card = applyReview(card, Rating.Easy, now).card; // straight to Review
    expect(card.state).toBe(State.Review);
    const later = new Date(card.due.getTime() + DAY);
    const lapsed = applyReview(card, Rating.Again, later).card;
    expect(lapsed.state).toBe(State.Relearning);
    expect(lapsed.lapses).toBe(1);
  });

  it("previews match what the scheduler then does (fuzz is off)", () => {
    const card = emptyCardFields(now);
    const preview = previewIntervals(card, now);
    expect(preview[1]).toBe(1 * MIN); // learning step 1m
    expect(preview[1]).toBeLessThan(preview[3]);
    expect(preview[3]).toBeLessThan(preview[4]);
    expect(applyReview(card, Rating.Easy, now).card.due.getTime() - now.getTime()).toBe(preview[4]);
  });

  it("learning cards repeat in the session, review cards do not", () => {
    const learning = applyReview(emptyCardFields(now), Rating.Again, now).card;
    expect(repeatsInSession(learning, now)).toBe(true);
    const review = applyReview(emptyCardFields(now), Rating.Easy, now).card;
    expect(repeatsInSession(review, now)).toBe(false);
  });
});

describe("localDayStart", () => {
  it("uses the device's local midnight", () => {
    expect(localDayStart(now, 540).toISOString()).toBe("2026-10-07T15:00:00.000Z"); // 00:00 KST
    expect(localDayStart(now, 0).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(localDayStart(new Date("2026-10-08T16:00:00Z"), 540).toISOString()).toBe("2026-10-08T15:00:00.000Z");
  });
});

describe("buildQueue", () => {
  const dayStart = localDayStart(now, 540);
  let seq = 0;
  const c = (over: Partial<QueueCandidate>): QueueCandidate => ({
    id: `c${++seq}`,
    card_type: "recognition",
    state: State.New,
    due: now.getTime(),
    word_created_at: seq,
    recognition_state: null,
    ...over,
  });
  const opts = { now, dayStart, newLimit: 2, introducedToday: 0 };

  it("puts due cards first (by due), then new cards, limited per day", () => {
    const due1 = c({ state: State.Review, due: now.getTime() - DAY });
    const due2 = c({ state: State.Review, due: now.getTime() - 2 * DAY });
    const news = [c({}), c({}), c({})];
    const q = buildQueue([...news, due1, due2], opts);
    expect(q.ids).toEqual([due2.id, due1.id, news[0]!.id, news[1]!.id]);
  });

  it("counts new cards already introduced today", () => {
    const news = [c({}), c({})];
    expect(buildQueue(news, { ...opts, introducedToday: 1 }).ids).toEqual([news[0]!.id]);
    expect(buildQueue(news, { ...opts, introducedToday: 5 }).ids).toEqual([]);
  });

  it("includes review cards due later today and learning cards due within 20 minutes", () => {
    const laterToday = c({ state: State.Review, due: dayStart.getTime() + DAY - MIN });
    const tomorrow = c({ state: State.Review, due: dayStart.getTime() + DAY });
    const learningSoon = c({ state: State.Learning, due: now.getTime() + 10 * MIN });
    const learningLater = c({ state: State.Learning, due: now.getTime() + 30 * MIN });
    const q = buildQueue([laterToday, tomorrow, learningSoon, learningLater], opts);
    expect(q.ids.sort()).toEqual([laterToday.id, learningSoon.id].sort());
  });

  it("new listening cards wait for their recognition card and are not limited", () => {
    const waiting = c({ card_type: "listening", recognition_state: State.New });
    const ready = [1, 2, 3].map(() => c({ card_type: "listening", recognition_state: State.Learning }));
    const q = buildQueue([waiting, ...ready], { ...opts, newLimit: 0 });
    expect(q.ids).toEqual(ready.map((r) => r.id));
  });
});
