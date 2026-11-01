// Answers given during a mock test, and which of them the server has actually acknowledged (M6.4).
// Pure: no fetch, no timers — the component owns those, these rules own the bookkeeping.

export type AnswerQueue = {
  /** Every answer the learner has given, by position. This is what the screen renders. */
  answers: Record<number, number>;
  /** Positions whose latest answer has not been acknowledged by the server yet. */
  pending: number[];
};

export const emptyQueue: AnswerQueue = { answers: {}, pending: [] };

/**
 * Records an answer and marks that position as needing a send.
 *
 * Changing an answer re-queues the position rather than queueing a second entry: only the latest
 * answer for a position matters, and the tape does not wait while a flaky connection catches up.
 */
export function answerGiven(queue: AnswerQueue, position: number, selected: number): AnswerQueue {
  return {
    answers: { ...queue.answers, [position]: selected },
    pending: queue.pending.includes(position) ? queue.pending : [...queue.pending, position],
  };
}

/**
 * The server acknowledged `position` carrying `selected`.
 *
 * The value matters: if the answer changed while the request was in flight, the acknowledgement is
 * for the old one and the position must stay queued, or the learner's final answer would be the
 * one that silently never arrived.
 */
export function answerAcknowledged(queue: AnswerQueue, position: number, selected: number): AnswerQueue {
  if (queue.answers[position] !== selected) return queue;
  return { ...queue, pending: queue.pending.filter((p) => p !== position) };
}

/** What `POST /tests/:id/finish` must carry so a dropped request never costs a mark. */
export function unsentAnswers(queue: AnswerQueue): { position: number; selected_option: number }[] {
  return queue.pending
    .filter((p) => queue.answers[p] !== undefined)
    .sort((a, b) => a - b)
    .map((position) => ({ position, selected_option: queue.answers[position]! }));
}

/** How many positions are still waiting to be sent — shown only at submit time, never mid-tape. */
export const unsentCount = (queue: AnswerQueue) => unsentAnswers(queue).length;

/** How far through the paper the learner is, for the progress bar. */
export const answeredCount = (queue: AnswerQueue) => Object.keys(queue.answers).length;
