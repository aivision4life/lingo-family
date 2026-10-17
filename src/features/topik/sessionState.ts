// Practice session's per-question progress (Prev/Next navigation + skip, M6.4-ish): pure state
// transitions with no React involved, so the rules the user actually cares about — a skipped
// question is never scored wrong, and the end-of-session tally counts only answered questions —
// are directly unit-testable even though this project has no component-level (.tsx) tests.
import type { TopikAttemptResult, TopikKeyTermView } from "@shared/topik";

export type QuestionState = { kind: "answered"; selected: number; result: TopikAttemptResult } | { kind: "skipped" };

export type SessionStates = Record<string, QuestionState>;

export type QuestionStatus = "answered" | "skipped" | "unanswered";

export function statusOf(states: SessionStates, questionId: string): QuestionStatus {
  return states[questionId]?.kind ?? "unanswered";
}

/** Marks `questionId` skipped — but only if it has no recorded state yet, so navigating away from
 * an already-answered question (to look at it again later) never overwrites its answer. */
export function markSkippedIfUnanswered(states: SessionStates, questionId: string): SessionStates {
  if (states[questionId]) return states;
  return { ...states, [questionId]: { kind: "skipped" } };
}

/** Records an answer, replacing any earlier "skipped" mark for the same question (the learner came
 * back to a skipped question and actually answered it). */
export function recordAnswer(states: SessionStates, questionId: string, selected: number, result: TopikAttemptResult): SessionStates {
  return { ...states, [questionId]: { kind: "answered", selected, result } };
}

/** Patches an already-answered question's explanation once the background job finishes (M6.4-ish
 * polling) — a no-op for a skipped/unanswered question, which has no result to patch. */
export function withExplanation(state: QuestionState, explanation_vi: string | null, key_terms: TopikKeyTermView[]): QuestionState {
  if (state.kind !== "answered") return state;
  return { ...state, result: { ...state.result, explanation_vi, key_terms, explain_ready: true } };
}

export type SessionSummary = { total: number; answered: number; correct: number; skipped: number };

/** End-of-session tally: a skipped question counts toward neither "answered" nor "correct" — only
 * a question the learner actually chose an option for does. */
export function summarize(questionIds: string[], states: SessionStates): SessionSummary {
  let answered = 0;
  let correct = 0;
  let skipped = 0;
  for (const id of questionIds) {
    const s = states[id];
    if (s?.kind === "answered") {
      answered++;
      if (s.result.is_correct) correct++;
    } else if (s?.kind === "skipped") {
      skipped++;
    }
  }
  return { total: questionIds.length, answered, correct, skipped };
}
