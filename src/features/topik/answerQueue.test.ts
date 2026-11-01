import { describe, expect, it } from "vitest";
import { answerAcknowledged, answerGiven, answeredCount, emptyQueue, unsentAnswers, unsentCount } from "./answerQueue";

describe("answerGiven", () => {
  it("records the answer and queues it for sending", () => {
    const q = answerGiven(emptyQueue, 3, 2);
    expect(q.answers).toEqual({ 3: 2 });
    expect(q.pending).toEqual([3]);
  });

  it("re-answering a position replaces the answer without queueing it twice", () => {
    const q = answerGiven(answerGiven(emptyQueue, 3, 2), 3, 4);
    expect(q.answers).toEqual({ 3: 4 });
    expect(q.pending).toEqual([3]);
  });
});

describe("answerAcknowledged", () => {
  it("clears a position once the server has the answer it is holding", () => {
    const q = answerAcknowledged(answerGiven(emptyQueue, 3, 2), 3, 2);
    expect(q.pending).toEqual([]);
    expect(q.answers).toEqual({ 3: 2 });
  });

  it("ignores an acknowledgement for an answer that has since changed", () => {
    // The request for "2" came back while the learner had already switched to "4": clearing the
    // position here would silently drop the answer that never reached the server.
    const changed = answerGiven(answerGiven(emptyQueue, 3, 2), 3, 4);
    expect(answerAcknowledged(changed, 3, 2).pending).toEqual([3]);
  });

  it("ignores an acknowledgement for a position that was never answered", () => {
    expect(answerAcknowledged(emptyQueue, 9, 1)).toEqual(emptyQueue);
  });
});

describe("unsentAnswers", () => {
  it("carries whatever never got through, in question order", () => {
    let q = answerGiven(emptyQueue, 5, 1);
    q = answerGiven(q, 2, 3);
    q = answerGiven(q, 9, 4);
    q = answerAcknowledged(q, 5, 1);
    expect(unsentAnswers(q)).toEqual([
      { position: 2, selected_option: 3 },
      { position: 9, selected_option: 4 },
    ]);
    expect(unsentCount(q)).toBe(2);
  });

  it("is empty when everything got through", () => {
    const q = answerAcknowledged(answerGiven(emptyQueue, 1, 1), 1, 1);
    expect(unsentAnswers(q)).toEqual([]);
  });
});

describe("answeredCount", () => {
  it("counts positions answered, not requests sent", () => {
    let q = answerGiven(emptyQueue, 1, 1);
    q = answerGiven(q, 1, 2);
    q = answerGiven(q, 2, 3);
    expect(answeredCount(q)).toBe(2);
  });
});
