import { describe, expect, it } from "vitest";
import type { TopikAttemptResult } from "@shared/topik";
import { markSkippedIfUnanswered, recordAnswer, statusOf, summarize, withExplanation } from "./sessionState";

const result = (over: Partial<TopikAttemptResult> = {}): TopikAttemptResult => ({
  is_correct: true,
  correct_option: 1,
  explanation_vi: null,
  key_terms: [],
  explain_ready: false,
  transcript: null,
  vocab: [],
  ...over,
});

describe("statusOf", () => {
  it("is unanswered for a question with no entry", () => {
    expect(statusOf({}, "q1")).toBe("unanswered");
  });
});

describe("markSkippedIfUnanswered", () => {
  it("marks an unanswered question skipped", () => {
    const states = markSkippedIfUnanswered({}, "q1");
    expect(statusOf(states, "q1")).toBe("skipped");
  });

  it("is idempotent for an already-skipped question", () => {
    const once = markSkippedIfUnanswered({}, "q1");
    const twice = markSkippedIfUnanswered(once, "q1");
    expect(twice).toEqual(once);
  });

  it("never overwrites an already-answered question (navigating away to look at it again)", () => {
    const answered = recordAnswer({}, "q1", 2, result());
    const after = markSkippedIfUnanswered(answered, "q1");
    expect(statusOf(after, "q1")).toBe("answered");
    expect(after).toEqual(answered);
  });

  it("leaves other questions untouched", () => {
    const states = markSkippedIfUnanswered({ q2: { kind: "skipped" } }, "q1");
    expect(statusOf(states, "q2")).toBe("skipped");
  });
});

describe("recordAnswer", () => {
  it("records a fresh answer", () => {
    const states = recordAnswer({}, "q1", 3, result({ is_correct: false }));
    expect(statusOf(states, "q1")).toBe("answered");
  });

  it("replaces an earlier skip with the real answer", () => {
    const skipped = markSkippedIfUnanswered({}, "q1");
    const answered = recordAnswer(skipped, "q1", 1, result());
    expect(statusOf(answered, "q1")).toBe("answered");
  });
});

describe("withExplanation", () => {
  it("patches an answered state's explanation/key_terms and flips explain_ready", () => {
    const state = { kind: "answered" as const, selected: 1, result: result({ explanation_vi: null, explain_ready: false }) };
    const patched = withExplanation(state, "vì...", [{ lemma: "가다", pos: "verb", gloss_vi: "đi", existing_word_id: null }]);
    expect(patched).toEqual({
      kind: "answered",
      selected: 1,
      result: result({ explanation_vi: "vì...", key_terms: [{ lemma: "가다", pos: "verb", gloss_vi: "đi", existing_word_id: null }], explain_ready: true }),
    });
  });

  it("is a no-op for a skipped state (nothing to patch)", () => {
    const state = { kind: "skipped" as const };
    expect(withExplanation(state, "vì...", [])).toBe(state);
  });
});

describe("summarize", () => {
  it("counts only answered questions toward answered/correct; skipped is tracked separately", () => {
    let states = recordAnswer({}, "q1", 1, result({ is_correct: true }));
    states = recordAnswer(states, "q2", 2, result({ is_correct: false }));
    states = markSkippedIfUnanswered(states, "q3");
    // q4 never visited at all — still counts toward `total`.
    expect(summarize(["q1", "q2", "q3", "q4"], states)).toEqual({ total: 4, answered: 2, correct: 1, skipped: 1 });
  });

  it("is all zero for an empty session state", () => {
    expect(summarize(["q1", "q2"], {})).toEqual({ total: 2, answered: 0, correct: 0, skipped: 0 });
  });
});
