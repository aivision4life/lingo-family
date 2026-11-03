// Practice session's per-question progress (Prev/Next navigation + skip, M6.4-ish): pure state
// transitions with no React involved, so the rules the user actually cares about — a skipped
// question is never scored wrong, and the end-of-session tally counts only answered questions —
// are directly unit-testable even though this project has no component-level (.tsx) tests.
import type { TopikAttemptResult, TopikKeyTermView } from "@shared/topik";

export type QuestionState =
  | { kind: "answered"; selected: number; result: TopikAttemptResult }
  | { kind: "skipped" }
  | { kind: "given_up" };

export type SessionStates = Record<string, QuestionState>;

export type QuestionStatus = "answered" | "skipped" | "given_up" | "unanswered";

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
 * back to a skipped question and actually answered it).
 *
 * **Except** after giving up (M7.5): asking to read the recording's words ends the right to answer
 * the questions about it, and the two cannot be reversed. Without this, the screen that shows the
 * transcript would still have answerable options under it — one tap on "Câu trước" away from an
 * answer worth nothing, with the words on screen, written into the schedule as if it were recall.
 */
export function recordAnswer(states: SessionStates, questionId: string, selected: number, result: TopikAttemptResult): SessionStates {
  if (states[questionId]?.kind === "given_up") return states;
  return { ...states, [questionId]: { kind: "answered", selected, result } };
}

/**
 * Gives up on every question of a group that is still unanswered, in exchange for its transcript.
 *
 * Nothing is sent to the server for these: a question nobody answered is not a question anyone got
 * wrong, so no attempt row and no card. An already-answered question is left exactly as it is.
 */
export function giveUp(states: SessionStates, questionIds: readonly string[]): SessionStates {
  const next = { ...states };
  for (const id of questionIds) {
    if (next[id]?.kind !== "answered") next[id] = { kind: "given_up" };
  }
  return next;
}

/** Whether every question of a group has been answered — what un-withholds the transcript. */
export const allAnswered = (states: SessionStates, questionIds: readonly string[]) =>
  questionIds.length > 0 && questionIds.every((id) => states[id]?.kind === "answered");

/** Whether the group has been given up on, which also reveals it (by the learner's own choice). */
export const anyGivenUp = (states: SessionStates, questionIds: readonly string[]) =>
  questionIds.some((id) => states[id]?.kind === "given_up");

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
    } else if (s?.kind === "skipped" || s?.kind === "given_up") {
      // Giving up counts with the skipped: nothing was answered, and the tally must not pretend
      // otherwise just because the transcript was read afterwards.
      skipped++;
    }
  }
  return { total: questionIds.length, answered, correct, skipped };
}
