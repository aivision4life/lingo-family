import { State } from "ts-fsrs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TopikQuestionInput, TopikVocabEntry } from "../../shared/topik";
import { fakeLlm } from "../test/fakeLlm";
import { FAKE_WEBP } from "../test/fakeUpload";
import { createTestEnv, testApp } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult: string;
let kid: string;

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of ["topik_attempts", "topik_cards", "topik_segments", "topik_audio", "topik_questions", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  adult = ((await t.api("POST", "/profiles", profile())).body as { id: string }).id;
  kid = ((await t.api("POST", "/profiles", profile({ name: "Bé", is_kid: true }))).body as { id: string }).id;
});

const profile = (over: Record<string, unknown> = {}) => ({
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 10, study_langs: ["ko"], ...over,
});

const input = (over: Partial<TopikQuestionInput> = {}): TopikQuestionInput => ({
  section: "reading",
  exam: "Test/연습1",
  number: 1,
  block: "1~2",
  instruction: "가장 알맞은 것을 고르십시오.",
  points: 2,
  stem: { text: "아침에 (   ) 전화를 드렸다.", image_key: null },
  options: [
    { text: "일어나서", image_key: null },
    { text: "일어나는데", image_key: null },
    { text: "일어나자마자", image_key: null },
    { text: "일어나고", image_key: null },
  ],
  correct_option: 3,
  ...over,
});

const createQuestion = async (over: Partial<TopikQuestionInput> = {}) => {
  const res = await t.api("POST", "/topik/questions", { ...input(over), profile_id: adult });
  expect(res.status).toBe(201);
  return res.body as { id: string };
};

describe("question bank CRUD", () => {
  it("an adult can create a question (immediately verified)", async () => {
    const q = await createQuestion();
    expect(q).toMatchObject({ verified: true, correct_option: 3, created_by_profile: adult });
  });

  it("a kid cannot create, patch, delete or verify-bulk", async () => {
    expect((await t.api("POST", "/topik/questions", { ...input(), profile_id: kid })).status).toBe(403);
    const q = await createQuestion();
    expect((await t.api("PATCH", `/topik/questions/${q.id}`, { profile_id: kid, correct_option: 1 })).status).toBe(403);
    expect((await t.api("DELETE", `/topik/questions/${q.id}`, { profile_id: kid })).status).toBe(403);
    expect((await t.api("POST", "/topik/questions/verify-bulk", { profile_id: kid, exam: "Test/연습1" })).status).toBe(403);
  });

  it("rejects a duplicate (section, exam, number)", async () => {
    await createQuestion();
    const res = await t.api("POST", "/topik/questions", { ...input(), profile_id: adult });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "topik_duplicate" });
  });

  it("patch edits fields and can approve (verified) separately from editing", async () => {
    const q = await createQuestion({ number: 5 }); // avoid clashing with the duplicate test's row
    const patched = await t.api("PATCH", `/topik/questions/${q.id}`, { profile_id: adult, instruction: "edited" });
    expect(patched.body).toMatchObject({ instruction: "edited", verified: true });
  });

  it("verify-bulk approves a whole exam without changing content", async () => {
    const res1 = await t.api("POST", "/topik/questions", { ...input({ number: 10 }), profile_id: adult });
    await t.env.DB.prepare("UPDATE topik_questions SET verified = 0 WHERE id = ?").bind((res1.body as { id: string }).id).run();
    const bulk = await t.api("POST", "/topik/questions/verify-bulk", { profile_id: adult, exam: "Test/연습1" });
    expect((bulk.body as { verified: number }).verified).toBeGreaterThanOrEqual(1);
  });

  it("deletes a question", async () => {
    const q = await createQuestion();
    expect((await t.api("DELETE", `/topik/questions/${q.id}`, { profile_id: adult })).status).toBe(204);
    expect((await t.api("GET", `/topik/questions?profile_id=${adult}`)).body).toEqual({ questions: [], total: 0 });
  });

  it("uploads a stem/option photo with TOPIK's own size limit", async () => {
    const res = await t.send(`/api/topik/questions/upload-image?profile_id=${adult}`, {
      method: "POST",
      headers: { "content-type": "image/webp" },
      body: FAKE_WEBP,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { image_key: string };
    expect(body.image_key).toMatch(/^images\/upload\/[0-9a-f]{40}\.webp$/);
  });
});

describe("question bank filter/search/pagination (review screen, M6.4-ish scaling)", () => {
  const list = (qs: string) => t.api("GET", `/topik/questions?profile_id=${adult}${qs}`) as Promise<{ body: { questions: { exam: string; number: number }[]; total: number } }>;

  it("filters by exam", async () => {
    await createQuestion({ exam: "A/연습1", number: 1 });
    await createQuestion({ exam: "B/연습1", number: 1 });
    const res = await list("&exam=A/연습1");
    expect(res.body.questions.map((q) => q.exam)).toEqual(["A/연습1"]);
    expect(res.body.total).toBe(1);
  });

  it("filters by block", async () => {
    await createQuestion({ number: 1, block: "1~2" });
    await createQuestion({ exam: "Test/연습2", number: 9, block: "9" });
    const res = await list("&block=9");
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0]).toMatchObject({ number: 9 });
  });

  it("searches by an exact question number when q is all digits", async () => {
    await createQuestion({ number: 1 });
    await createQuestion({ exam: "Test/연습2", number: 42 });
    const res = await list("&q=42");
    expect(res.body.questions).toEqual([expect.objectContaining({ number: 42 })]);
  });

  it("searches by stem/option content otherwise", async () => {
    await createQuestion({ number: 1, stem: { text: "아주 특별한 단어가 있다.", image_key: null } });
    await createQuestion({ exam: "Test/연습2", number: 2 });
    const res = await list(`&q=${encodeURIComponent("특별한")}`);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0]).toMatchObject({ number: 1 });
  });

  it("finds a match inside an option's text too", async () => {
    await createQuestion({ number: 1, options: [{ text: "독특한보기", image_key: null }, { text: "a", image_key: null }, { text: "b", image_key: null }, { text: "c", image_key: null }] });
    const res = await list(`&q=${encodeURIComponent("독특한")}`);
    expect(res.body.questions).toHaveLength(1);
  });

  it("paginates with limit/offset and reports the true total", async () => {
    for (let n = 1; n <= 5; n++) await createQuestion({ number: n });
    const page1 = await list("&limit=2&offset=0");
    expect(page1.body.questions).toHaveLength(2);
    expect(page1.body.total).toBe(5);
    const page2 = await list("&limit=2&offset=2");
    expect(page2.body.questions.map((q) => q.number)).toEqual([3, 4]);
    const page3 = await list("&limit=2&offset=4");
    expect(page3.body.questions.map((q) => q.number)).toEqual([5]);
  });

  it("facets list only the exams/blocks that currently have a matching row, scoped to the same verified filter", async () => {
    await createQuestion({ exam: "A/연습1", number: 1, block: "1~2" });
    await createQuestion({ exam: "B/연습1", number: 9, block: "9" });
    await t.env.DB.prepare("UPDATE topik_questions SET verified = 0 WHERE exam = 'B/연습1'").run();

    const all = await t.api("GET", `/topik/questions/facets?profile_id=${adult}`);
    expect(all.body).toEqual({ exams: ["A/연습1", "B/연습1"], blocks: ["1~2", "9"] });

    const verifiedOnly = await t.api("GET", `/topik/questions/facets?profile_id=${adult}&verified=1`);
    expect(verifiedOnly.body).toEqual({ exams: ["A/연습1"], blocks: ["1~2"] });
  });

  it("facets endpoint is adult-only", async () => {
    expect((await t.api("GET", `/topik/questions/facets?profile_id=${kid}`)).status).toBe(403);
  });
});

describe("blocks + practice session", () => {
  it("lists blocks grouped from verified questions only", async () => {
    await createQuestion({ number: 1 });
    await createQuestion({ number: 2, exam: "Test/연습2" });
    const unverified = await t.api("POST", "/topik/questions", { ...input({ number: 99, exam: "Test/연습3", block: "99" }), profile_id: adult });
    await t.env.DB.prepare("UPDATE topik_questions SET verified = 0 WHERE id = ?").bind((unverified.body as { id: string }).id).run();

    const blocks = (await t.api("GET", "/topik/blocks?section=reading")).body as { block: string; from: number; to: number; count: number }[];
    expect(blocks).toEqual([
      { section: "reading", block: "1~2", from: 1, to: 2, count: 2, unseen: 2, mastered: 0, due: 0, later: 0, next_due_at: null },
    ]);
  });

  // M6.9: the block picker shows "not studied / total" per profile, from this one query.
  it("counts the questions a profile has never answered, per profile and per block", async () => {
    const q1 = await createQuestion({ number: 1 });
    await createQuestion({ number: 2, exam: "Test/연습2" });
    await createQuestion({ number: 9, exam: "Test/연습3", block: "9" });

    const blocksFor = async (profileId: string) =>
      (await t.api("GET", `/topik/blocks?section=reading&profile_id=${profileId}`)).body as { block: string; count: number; unseen: number }[];
    expect(await blocksFor(adult)).toEqual([
      { section: "reading", block: "1~2", from: 1, to: 2, count: 2, unseen: 2, mastered: 0, due: 0, later: 0, next_due_at: null },
      { section: "reading", block: "9", from: 9, to: 9, count: 1, unseen: 1, mastered: 0, due: 0, later: 0, next_due_at: null },
    ]);

    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q1.id, selected_option: 1, duration_ms: 1000 });
    // Answering twice must not count the question twice (the join is over distinct question ids).
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q1.id, selected_option: 3, duration_ms: 1000 });

    const afterAdult = await blocksFor(adult);
    expect(afterAdult[0]).toMatchObject({ block: "1~2", count: 2, unseen: 1 });
    expect(afterAdult[1]).toMatchObject({ block: "9", count: 1, unseen: 1 });
    // Another profile's history is its own.
    expect(await blocksFor(kid)).toMatchObject([{ unseen: 2 }, { unseen: 1 }]);
  });

  // M6.11: the bar's dark segment. "Mastered" = the question's own card reached ts-fsrs Review,
  // the same rule the vocabulary key-terms use for "already knows it".
  it("counts a question as mastered only once its card reaches the Review state", async () => {
    const q = await createQuestion({ number: 1 });
    await createQuestion({ number: 2, exam: "Test/연습2" });
    const blocksFor = async (profileId: string) =>
      (await t.api("GET", `/topik/blocks?section=reading&profile_id=${profileId}`)).body as { count: number; unseen: number; mastered: number }[];

    // One correct answer: the card exists and is in learning, not Review yet.
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 3, duration_ms: 1000 });
    expect(await blocksFor(adult)).toMatchObject([{ count: 2, unseen: 1, mastered: 0 }]);

    await t.env.DB.prepare("UPDATE topik_cards SET state = ? WHERE profile_id = ? AND question_id = ?")
      .bind(State.Review, adult, q.id)
      .run();
    expect(await blocksFor(adult)).toMatchObject([{ count: 2, unseen: 1, mastered: 1 }]);
    // Another profile has its own cards, so its own count.
    expect(await blocksFor(kid)).toMatchObject([{ count: 2, unseen: 2, mastered: 0 }]);
  });

  // M7.2: the picker promised work while the session came back empty, which read as a bug. The
  // two now answer from the same clock: due/later/next_due_at say what a session would serve.
  it("separates questions due now from questions waiting out their interval", async () => {
    const q1 = await createQuestion({ number: 1 });
    const q2 = await createQuestion({ number: 2, exam: "Test/연습2" });
    const blocksFor = async () =>
      ((await t.api("GET", `/topik/blocks?section=reading&profile_id=${adult}`)).body as {
        count: number;
        unseen: number;
        due: number;
        later: number;
        next_due_at: number | null;
      }[])[0]!;

    // Nothing answered: both are "unseen", which a session serves, and nothing is waiting.
    expect(await blocksFor()).toMatchObject({ count: 2, unseen: 2, due: 0, later: 0, next_due_at: null });

    // Answer both. A fresh learning card is due minutes from now, so neither is due again yet.
    for (const q of [q1, q2]) {
      await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 3, duration_ms: 1000 });
    }
    const waiting = await blocksFor();
    expect(waiting).toMatchObject({ count: 2, unseen: 0, due: 0, later: 2 });
    expect(waiting.next_due_at).toBeGreaterThan(Date.now());

    // ...and this is exactly when a session is empty: the screen can now say why.
    const session = (await t.api("GET", `/topik/session?section=reading&from=1&to=2&profile_id=${adult}`)).body as { questions: unknown[] };
    expect(session.questions).toEqual([]);

    // Once one of them comes due again, it is counted as due, not waiting.
    await t.env.DB.prepare("UPDATE topik_cards SET due = ? WHERE profile_id = ? AND question_id = ?")
      .bind(Date.now() - 60_000, adult, q1.id)
      .run();
    expect(await blocksFor()).toMatchObject({ count: 2, unseen: 0, due: 1, later: 1 });
    const after = (await t.api("GET", `/topik/session?section=reading&from=1&to=2&profile_id=${adult}`)).body as { questions: { id: string }[] };
    expect(after.questions.map((q) => q.id)).toEqual([q1.id]);
  });

  // M7.2: "practise anyway". Two promises are tested together here because breaking either one
  // makes the numbers lie: the attempt is kept (flagged), and nothing about the schedule moves.
  it("records a practise-anyway answer without creating or moving a card", async () => {
    const fresh = await createQuestion({ number: 1 });
    const answered = await createQuestion({ number: 2, exam: "Test/연습2" });
    const cardsFor = async (questionId: string) =>
      (
        await t.env.DB.prepare("SELECT due, state, reps FROM topik_cards WHERE profile_id = ? AND question_id = ?")
          .bind(adult, questionId)
          .all<{ due: number; state: number; reps: number }>()
      ).results;

    // A normal answer on the second question: it gets a card, as always.
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: answered.id, selected_option: 3, duration_ms: 1000 });
    const before = (await cardsFor(answered.id))[0]!;

    // Now practise both ahead of schedule.
    for (const q of [fresh, answered]) {
      await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 1, duration_ms: 500, schedule: false });
    }

    // The question that had no card still has none: a real review must still see it as new.
    expect(await cardsFor(fresh.id)).toEqual([]);
    // The one that had a card is untouched — same due date, same state, same count of reviews.
    expect((await cardsFor(answered.id))[0]).toEqual(before);

    // Both answers are in the history, flagged as outside the schedule.
    const attempts = (
      await t.env.DB.prepare("SELECT question_id, scheduled FROM topik_attempts WHERE profile_id = ? ORDER BY created_at")
        .bind(adult)
        .all<{ question_id: string; scheduled: number }>()
    ).results;
    expect(attempts).toEqual([
      { question_id: answered.id, scheduled: 1 },
      { question_id: fresh.id, scheduled: 0 },
      { question_id: answered.id, scheduled: 0 },
    ]);
  });

  it("counts a question as unseen until it has a card, so extra practice never moves the number", async () => {
    const q = await createQuestion({ number: 1 });
    await createQuestion({ number: 2, exam: "Test/연습2" });
    const unseenNow = async () =>
      ((await t.api("GET", `/topik/blocks?section=reading&profile_id=${adult}`)).body as { unseen: number }[])[0]!.unseen;

    expect(await unseenNow()).toBe(2);
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 1, duration_ms: 500, schedule: false });
    // The attempt exists, but no card does — and "unseen" follows the cards, so it must not move.
    expect(await unseenNow()).toBe(2);
    // The next real session still hands the question out as a new one.
    const session = (await t.api("GET", `/topik/session?section=reading&from=1&to=2&profile_id=${adult}`)).body as { questions: { id: string }[] };
    expect(session.questions.map((x) => x.id)).toContain(q.id);

    // A scheduled answer is what makes it seen.
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 1, duration_ms: 500 });
    expect(await unseenNow()).toBe(1);
  });

  it("mode=all serves a block whose questions are all waiting, and leaves them waiting", async () => {
    const q = await createQuestion({ number: 1 });
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 3, duration_ms: 1000 });
    const dueBefore = (
      await t.env.DB.prepare("SELECT due FROM topik_cards WHERE profile_id = ? AND question_id = ?").bind(adult, q.id).all<{ due: number }>()
    ).results[0]!.due;

    const ask = async (mode: string) =>
      ((await t.api("GET", `/topik/session?section=reading&from=1&to=1&profile_id=${adult}&mode=${mode}`)).body as { questions: unknown[] }).questions;
    expect(await ask("due")).toEqual([]);
    expect(await ask("all")).toHaveLength(1);

    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 1, duration_ms: 500, schedule: false });
    const dueAfter = (
      await t.env.DB.prepare("SELECT due FROM topik_cards WHERE profile_id = ? AND question_id = ?").bind(adult, q.id).all<{ due: number }>()
    ).results[0]!.due;
    expect(dueAfter).toBe(dueBefore);
  });

  it("does not count an unverified question, answered or not", async () => {
    await createQuestion({ number: 1 });
    const hidden = await createQuestion({ number: 2, exam: "Test/연습2" });
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: hidden.id, selected_option: 1, duration_ms: 1000 });
    await t.env.DB.prepare("UPDATE topik_questions SET verified = 0 WHERE id = ?").bind(hidden.id).run();

    const blocks = (await t.api("GET", `/topik/blocks?section=reading&profile_id=${adult}`)).body as { count: number; unseen: number }[];
    expect(blocks).toMatchObject([{ count: 1, unseen: 1 }]);
  });

  // M6.13: the session length is the profile's own setting, not a constant.
  it("asks as many questions as the profile's session_size says", async () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await createQuestion({ number: n, block: "1~7" });
    const sessionFor = async (profileId: string) =>
      ((await t.api("GET", `/topik/session?section=reading&from=1&to=7&profile_id=${profileId}`)).body as { questions: unknown[] }).questions.length;

    const short = ((await t.api("POST", "/profiles", profile({ name: "Ngắn", session_size: 5 }))).body as { id: string }).id;
    expect(await sessionFor(short)).toBe(5);
    // The default profile keeps asking for 10, so it gets everything the block has.
    expect(await sessionFor(adult)).toBe(7);

    await t.api("PATCH", `/profiles/${short}`, { session_size: 20 });
    expect(await sessionFor(short)).toBe(7);
  });

  // The 100-parameter ceiling: a 20-question session reads cards and clips by id, and the card
  // query's IN list is the whole block, which is bigger still. Both are chunked; this runs it at a
  // size that would have failed as one statement.
  it("serves a 20-question session from a block of 105 questions", async () => {
    // 105, not 60: the card query binds one parameter per question in the block plus the profile,
    // so it only crosses D1's ceiling of 100 above a hundred questions. A smaller block would pass
    // either way and prove nothing.
    for (let n = 1; n <= 105; n += 1) await createQuestion({ number: n, block: "1~105" });
    const big = ((await t.api("POST", "/profiles", profile({ name: "Dài", session_size: 20 }))).body as { id: string }).id;
    const res = await t.api("GET", `/topik/session?section=reading&from=1&to=105&profile_id=${big}`);
    expect(res.status).toBe(200);
    expect((res.body as { questions: unknown[] }).questions).toHaveLength(20);
  });

  it("a practice session never includes the answer, and defaults to the empty-card order", async () => {
    await createQuestion({ number: 1 });
    await createQuestion({ number: 2, exam: "Test/연습2" });
    const res = await t.api("GET", `/topik/session?profile_id=${adult}&section=reading&from=1&to=2`);
    const { questions } = res.body as { questions: Record<string, unknown>[] };
    expect(questions).toHaveLength(2);
    expect(questions[0]).not.toHaveProperty("correct_option");
  });

  it("submitting an attempt scores it, creates a topik_cards row, and logs history", async () => {
    const q = await createQuestion();
    const wrong = await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 1, duration_ms: 4000 });
    expect(wrong.body).toMatchObject({ is_correct: false, correct_option: 3 });

    const card = await t.env.DB.prepare("SELECT lapses, reps FROM topik_cards WHERE profile_id = ? AND question_id = ?").bind(adult, q.id).first();
    expect(card).toMatchObject({ reps: 1 });

    const history = await t.env.DB.prepare("SELECT is_correct, duration_ms, number, exam FROM topik_attempts WHERE profile_id = ?").bind(adult).all();
    expect(history.results).toEqual([{ is_correct: 0, duration_ms: 4000, number: 1, exam: "Test/연습1" }]);

    const right = await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 3 });
    expect(right.body).toMatchObject({ is_correct: true });
  });

  it("404s for an attempt on an unknown question", async () => {
    expect((await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: "nope", selected_option: 1 })).status).toBe(404);
  });

  it("GET .../stats tallies one profile's own full history on one question, never leaking the answer", async () => {
    const q = await createQuestion();
    expect((await t.api("GET", `/topik/questions/${q.id}/stats?profile_id=${adult}`)).body).toEqual({ attempts: 0, correct: 0 });

    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 1 }); // wrong
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 3 }); // right
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 3 }); // right

    const stats = await t.api("GET", `/topik/questions/${q.id}/stats?profile_id=${adult}`);
    expect(stats.body).toEqual({ attempts: 3, correct: 2 });
    expect(stats.body).not.toHaveProperty("correct_option");

    // A different profile's attempts on the same question never mix in.
    const other = await t.api("GET", `/topik/questions/${q.id}/stats?profile_id=${kid}`);
    expect(other.body).toEqual({ attempts: 0, correct: 0 });
  });
});

describe("per-question vocabulary + explanation (M6.2 'tap a word', M6.3 answer explanation)", () => {
  const sample = { words: [{ surface: "일어나서", lemma: "일어나다", pos: "verb", gloss_vi: "thức dậy" }] };
  const explainSample = { explanation_vi: "Vì câu diễn tả một hành động đã xảy ra trước đó.", key_terms: ["일어나다"] };
  let tv: Awaited<ReturnType<typeof createTestEnv>>;
  let llm: ReturnType<typeof fakeLlm>;
  let adultV: string;

  beforeAll(async () => {
    // generateStructured calls generate() once for vocab, then once for the explanation (in that
    // order, within the same background job) — [vocab, explain] covers both, repeating the
    // explanation shape for any further call in a test that triggers more than one round.
    llm = fakeLlm([JSON.stringify(sample), JSON.stringify(explainSample)]);
    tv = await createTestEnv(testApp({ makeLlm: () => llm.client }));
  }, 60_000);
  afterAll(() => tv.dispose());

  beforeEach(async () => {
    for (const table of ["usage_daily", "ai_cache", "topik_attempts", "topik_cards", "topik_questions", "profiles"]) {
      await tv.env.DB.prepare(`DELETE FROM ${table}`).run();
    }
    llm.requests.length = 0;
    adultV = ((await tv.api("POST", "/profiles", profile())).body as { id: string }).id;
  });

  it("generates vocab + explanation in the background when a manual question is created, logging usage with no quota check", async () => {
    const res = await tv.api("POST", "/topik/questions", { ...input(), profile_id: adultV });
    expect((res.body as { vocab: unknown[] }).vocab).toEqual([]); // not generated yet: the response does not wait for it
    await tv.settle();

    const row = (await tv.api("GET", `/topik/questions?profile_id=${adultV}`)).body as {
      questions: { vocab: TopikVocabEntry[]; explanation_vi: string | null; key_terms: string[] }[];
    };
    expect(row.questions[0]!.vocab).toEqual(sample.words);
    expect(row.questions[0]!.explanation_vi).toBe(explainSample.explanation_vi);
    expect(row.questions[0]!.key_terms).toEqual(["일어나다"]);
    expect(llm.requests).toHaveLength(2); // 1 vocab call + 1 explanation call

    const vocabUsage = await tv.env.DB.prepare("SELECT count FROM usage_daily WHERE profile_id = ? AND service = 'topik_vocab'").bind(adultV).first();
    expect(vocabUsage).toMatchObject({ count: 1 });
    const explainUsage = await tv.env.DB.prepare("SELECT count FROM usage_daily WHERE profile_id = ? AND service = 'topik_explain'").bind(adultV).first();
    expect(explainUsage).toMatchObject({ count: 1 });
  });

  it("regenerates when the stem/options text changes, but not when instruction or an unrelated field changes", async () => {
    const q = await tv.api("POST", "/topik/questions", { ...input(), profile_id: adultV });
    await tv.settle();
    llm.requests.length = 0;

    // Same text, only `warning` cleared: no new LLM call.
    await tv.api("PATCH", `/topik/questions/${(q.body as { id: string }).id}`, { profile_id: adultV, warning: null });
    await tv.settle();
    expect(llm.requests).toHaveLength(0);

    // Instruction changes: it is never part of the vocabulary text, so no regeneration either (it
    // just repeats the same block-wide boilerplate across every question).
    await tv.api("PATCH", `/topik/questions/${(q.body as { id: string }).id}`, { profile_id: adultV, instruction: "새로운 지시문입니다." });
    await tv.settle();
    expect(llm.requests).toHaveLength(0);

    // The stem text changes: both vocab and explanation regenerate.
    await tv.api("PATCH", `/topik/questions/${(q.body as { id: string }).id}`, { profile_id: adultV, stem: { text: "완전히 다른 문장이다.", image_key: null } });
    await tv.settle();
    expect(llm.requests).toHaveLength(2);
  });

  it("regenerates only the explanation when correct_option changes without any text change", async () => {
    const q = await tv.api("POST", "/topik/questions", { ...input(), profile_id: adultV });
    await tv.settle();
    // Not reset to 0 here: with only one more call expected (explanation-only), resetting would
    // shift fakeLlm's position-based output selection back to the vocab-shaped response instead.
    const before = llm.requests.length;

    await tv.api("PATCH", `/topik/questions/${(q.body as { id: string }).id}`, { profile_id: adultV, correct_option: 2 });
    await tv.settle();
    expect(llm.requests.length - before).toBe(1); // explanation only — vocab text did not change
  });

  it("verify-bulk never generates vocab/explanation, even for rows that never had either (M6.4-ish)", async () => {
    // q1: created through the normal (manual) flow, already verified → already has both.
    await tv.api("POST", "/topik/questions", { ...input({ number: 1 }), profile_id: adultV });
    await tv.settle();
    llm.requests.length = 0;

    // q2: inserted directly like the import script would — unverified, neither ever checked.
    await tv.env.DB.prepare(
      `INSERT INTO topik_questions (id, section, exam, number, block, options, correct_option, verified, created_at, updated_at)
       VALUES (?1, 'reading', 'Test/연습1', 2, '1~2', ?2, 1, 0, 0, 0)`,
    )
      .bind(
        "q2",
        JSON.stringify([
          { text: "답1", image_key: null },
          { text: "답2", image_key: null },
          { text: "답3", image_key: null },
          { text: "답4", image_key: null },
        ]),
      )
      .run();

    const bulk = await tv.api("POST", "/topik/questions/verify-bulk", { profile_id: adultV, exam: "Test/연습1" });
    expect((bulk.body as { verified: number }).verified).toBe(2); // both rows match the exam filter
    await tv.settle();

    expect(llm.requests).toHaveLength(0);
    const q2row = await tv.env.DB.prepare("SELECT vocab_checked_at, explain_checked_at FROM topik_questions WHERE id = 'q2'").first();
    expect(q2row!.vocab_checked_at).toBeNull();
    expect(q2row!.explain_checked_at).toBeNull();
  });

  it("a practice session kicks off generation only for the questions it actually picked (M6.4-ish)", async () => {
    // q1 inside the session's range, never generated; q2 outside the range, must stay untouched.
    await tv.env.DB.prepare(
      `INSERT INTO topik_questions (id, section, exam, number, block, options, correct_option, verified, created_at, updated_at)
       VALUES (?1, 'reading', 'Test/연습1', ?2, '1~2', ?3, 1, 1, 0, 0)`,
    )
      .bind(
        "q1",
        1,
        JSON.stringify([
          { text: "일어나서", image_key: null },
          { text: "답2", image_key: null },
          { text: "답3", image_key: null },
          { text: "답4", image_key: null },
        ]),
      )
      .run();
    await tv.env.DB.prepare(
      `INSERT INTO topik_questions (id, section, exam, number, block, options, correct_option, verified, created_at, updated_at)
       VALUES (?1, 'reading', 'Test/연습1', ?2, '9', ?3, 1, 1, 0, 0)`,
    )
      .bind(
        "q2",
        9,
        JSON.stringify([
          { text: "답1", image_key: null },
          { text: "답2", image_key: null },
          { text: "답3", image_key: null },
          { text: "답4", image_key: null },
        ]),
      )
      .run();

    const res = await tv.api("GET", `/topik/session?profile_id=${adultV}&section=reading&from=1&to=1`);
    const questions = (res.body as { questions: { id: string; vocab_ready: boolean }[] }).questions;
    expect(questions).toEqual([expect.objectContaining({ id: "q1", vocab_ready: false })]); // not generated yet, the response does not wait for it
    await tv.settle();

    expect(llm.requests).toHaveLength(2); // vocab + explanation for q1 only
    const q1row = await tv.env.DB.prepare("SELECT vocab_checked_at FROM topik_questions WHERE id = 'q1'").first();
    expect(q1row!.vocab_checked_at).not.toBeNull();
    const q2row = await tv.env.DB.prepare("SELECT vocab_checked_at FROM topik_questions WHERE id = 'q2'").first();
    expect(q2row!.vocab_checked_at).toBeNull();
  });

  it("a session never re-triggers generation for a question that is already fully ready", async () => {
    await tv.api("POST", "/topik/questions", { ...input({ number: 1 }), profile_id: adultV });
    await tv.settle();
    llm.requests.length = 0;

    await tv.api("GET", `/topik/session?profile_id=${adultV}&section=reading&from=1&to=1`);
    await tv.settle();
    expect(llm.requests).toHaveLength(0);
  });

  it("GET .../content reports readiness and the review screen's generate-content button fills in a missing one", async () => {
    const q = await tv.env.DB.prepare(
      `INSERT INTO topik_questions (id, section, exam, number, block, options, correct_option, verified, created_at, updated_at)
       VALUES ('q1', 'reading', 'Test/연습1', 1, '1~2', ?1, 1, 1, 0, 0) RETURNING id`,
    )
      .bind(
        JSON.stringify([
          { text: "일어나서", image_key: null },
          { text: "답2", image_key: null },
          { text: "답3", image_key: null },
          { text: "답4", image_key: null },
        ]),
      )
      .first<{ id: string }>();

    const before = await tv.api("GET", `/topik/questions/${q!.id}/content?profile_id=${adultV}`);
    expect(before.body).toMatchObject({ vocab: [], vocab_ready: false, explanation_vi: null, explain_ready: false });

    const kick = await tv.api("POST", `/topik/questions/${q!.id}/generate-content`, { profile_id: adultV });
    expect(kick.body).toEqual({ started: true });
    await tv.settle();

    const after = await tv.api("GET", `/topik/questions/${q!.id}/content?profile_id=${adultV}`);
    expect(after.body).toMatchObject({ vocab: sample.words, vocab_ready: true, explanation_vi: explainSample.explanation_vi, explain_ready: true });

    // Already fully generated now: a second click is a no-op (no further LLM calls).
    llm.requests.length = 0;
    const again = await tv.api("POST", `/topik/questions/${q!.id}/generate-content`, { profile_id: adultV });
    expect(again.body).toEqual({ started: false });
    await tv.settle();
    expect(llm.requests).toHaveLength(0);
  });

  it("generate-content is adult-only and 404s for an unknown question", async () => {
    const q = await tv.api("POST", "/topik/questions", { ...input(), profile_id: adultV });
    await tv.settle();
    const id = (q.body as { id: string }).id;
    expect((await tv.api("POST", `/topik/questions/${id}/generate-content`, { profile_id: adultV })).status).toBe(200);
    const kidId = ((await tv.api("POST", "/profiles", profile({ name: "Bé", is_kid: true }))).body as { id: string }).id;
    expect((await tv.api("POST", `/topik/questions/${id}/generate-content`, { profile_id: kidId })).status).toBe(403);
    expect((await tv.api("POST", "/topik/questions/nope/generate-content", { profile_id: adultV })).status).toBe(404);
  });
});

describe("answer explanation exposure (M6.3)", () => {
  const sample = { words: [{ surface: "일어나서", lemma: "일어나다", pos: "verb", gloss_vi: "thức dậy" }] };
  const explainSample = { explanation_vi: "Giải thích mẫu.", key_terms: ["일어나다"] };
  let tv: Awaited<ReturnType<typeof createTestEnv>>;
  let llm: ReturnType<typeof fakeLlm>;
  let adultE: string;

  beforeAll(async () => {
    llm = fakeLlm([JSON.stringify(sample), JSON.stringify(explainSample)]);
    tv = await createTestEnv(testApp({ makeLlm: () => llm.client }));
  }, 60_000);
  afterAll(() => tv.dispose());

  beforeEach(async () => {
    for (const table of ["usage_daily", "ai_cache", "topik_attempts", "topik_cards", "topik_questions", "cards", "words", "profiles"]) {
      await tv.env.DB.prepare(`DELETE FROM ${table}`).run();
    }
    llm.requests.length = 0;
    adultE = ((await tv.api("POST", "/profiles", profile())).body as { id: string }).id;
  });

  const createAndWait = async () => {
    const q = await tv.api("POST", "/topik/questions", { ...input(), profile_id: adultE });
    await tv.settle();
    return (q.body as { id: string }).id;
  };

  it("never appears in the practice session (would leak the answer)", async () => {
    await createAndWait();
    const session = await tv.api("GET", `/topik/session?profile_id=${adultE}&section=reading&from=1&to=1`);
    const q = (session.body as { questions: Record<string, unknown>[] }).questions[0]!;
    expect(q).not.toHaveProperty("explanation_vi");
    expect(q).not.toHaveProperty("key_terms");
  });

  it("attaches the real stem/option images when generating the explanation (never guesses their content)", async () => {
    const upload = await tv.send(`/api/topik/questions/upload-image?profile_id=${adultE}`, {
      method: "POST",
      headers: { "content-type": "image/webp" },
      body: FAKE_WEBP,
    });
    const { image_key } = (await upload.json()) as { image_key: string };

    await tv.api("POST", "/topik/questions", { ...input({ stem: { text: null, image_key } }), profile_id: adultE });
    await tv.settle();

    const explainCall = llm.requests.find((r) => (r.images?.length ?? 0) > 0);
    expect(explainCall?.images).toEqual([{ label: "Hình ảnh đề bài:", mimeType: "image/webp", data: expect.any(String) }]);
  });

  it("never generates an explanation when a referenced image can't be fetched from R2 (no guessing)", async () => {
    const q = await tv.api("POST", "/topik/questions", { ...input({ stem: { text: null, image_key: "no-such-key" } }), profile_id: adultE });
    await tv.settle();

    const row = (await tv.api("GET", `/topik/questions?profile_id=${adultE}`)).body as {
      questions: { exam: string; explanation_vi: string | null }[];
    };
    const found = row.questions.find((r) => r.exam === (q.body as { exam: string }).exam);
    expect(found!.explanation_vi).toBeNull();
    // Vocab (which does not need the image) still generated normally; only the explain call is skipped.
    expect(llm.requests.some((r) => (r.images?.length ?? 0) > 0)).toBe(false);
  });

  it("is returned on the attempt response, with a key term the profile has never seen marked as new", async () => {
    const id = await createAndWait();
    const res = await tv.api("POST", "/topik/attempts", { profile_id: adultE, question_id: id, selected_option: 2 });
    const body = res.body as { explanation_vi: string | null; key_terms: { lemma: string; existing_word_id: string | null }[] };
    expect(body.explanation_vi).toBe(explainSample.explanation_vi);
    expect(body.key_terms).toEqual([{ lemma: "일어나다", pos: "verb", gloss_vi: "thức dậy", existing_word_id: null }]);
  });

  it("drops a key term whose word the profile already knows (recognition card at Review state)", async () => {
    const id = await createAndWait();
    await tv.env.DB.prepare("INSERT INTO words (id, lang, term, reading, pos, gloss_vi, gloss_en, gloss_ko, image_status, ai_generated, verified, created_at, updated_at) VALUES ('w1','ko','일어나다','ireonada','verb','thức dậy','wake up','일어나다','none',1,1,0,0)").run();
    await tv.env.DB.prepare(
      "INSERT INTO cards (id, profile_id, word_id, card_type, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, updated_at) VALUES ('c1', ?1, 'w1', 'recognition', 0, 1, 1, 0, 0, 0, 1, 0, 2, 0)",
    )
      .bind(adultE)
      .run();

    const res = await tv.api("POST", "/topik/attempts", { profile_id: adultE, question_id: id, selected_option: 2 });
    expect((res.body as { key_terms: unknown[] }).key_terms).toEqual([]);
  });

  it("shows a known-but-weak library word with its existing id instead of offering to add it again", async () => {
    const id = await createAndWait();
    await tv.env.DB.prepare("INSERT INTO words (id, lang, term, reading, pos, gloss_vi, gloss_en, gloss_ko, image_status, ai_generated, verified, created_at, updated_at) VALUES ('w1','ko','일어나다','ireonada','verb','thức dậy','wake up','일어나다','none',1,1,0,0)").run();
    // No card at all yet for this profile: still "weak" (not yet studied), not dropped.
    const res = await tv.api("POST", "/topik/attempts", { profile_id: adultE, question_id: id, selected_option: 2 });
    expect((res.body as { key_terms: { existing_word_id: string | null }[] }).key_terms).toEqual([
      { lemma: "일어나다", pos: "verb", gloss_vi: "thức dậy", existing_word_id: "w1" },
    ]);
  });
});

// M7.1: one mp3 per listening exam, clips are timestamps into it, and nothing reaches practice
// until an adult approves the boundaries.
describe("listening audio", () => {
  const listening = (number: number, over: Partial<TopikQuestionInput> = {}) =>
    createQuestion({ section: "listening", exam: "Listen-60회", number, block: "1~3", ...over });

  const addAudio = async (verified = false) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    await t.env.DB.prepare(
      `INSERT INTO topik_audio (id, section, exam, audio_key, duration_ms, verified, created_at, updated_at)
       VALUES (?, 'listening', 'Listen-60회', 'topik/audio/${"a".repeat(40)}.mp3', 600000, ?, ?, ?)`,
    ).bind(id, verified ? 1 : 0, now, now).run();
    return id;
  };
  const addSegment = async (audioId: string, idx: number, start: number, speechEnd: number, end: number) => {
    const id = crypto.randomUUID();
    await t.env.DB.prepare(
      "INSERT INTO topik_segments (id, audio_id, idx, start_ms, speech_end_ms, end_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, audioId, idx, start, speechEnd, end, Date.now()).run();
    return id;
  };

  it("lists an exam's audio with its segment and question counts", async () => {
    const q = await listening(1);
    const audioId = await addAudio();
    const segmentId = await addSegment(audioId, 1, 1000, 20000, 26000);
    await t.api("PATCH", `/topik/questions/${q.id}/segment`, { profile_id: adult, segment_id: segmentId });

    const list = (await t.api("GET", `/topik/audio?profile_id=${adult}`)).body as Record<string, unknown>[];
    expect(list).toMatchObject([{ exam: "Listen-60회", verified: false, segment_count: 1, question_count: 1, unassigned_questions: 0 }]);
  });

  it("returns the segments with the question numbers asked about each", async () => {
    const q21 = await listening(21);
    const q22 = await listening(22);
    const audioId = await addAudio();
    const shared = await addSegment(audioId, 1, 1000, 20000, 26000);
    await addSegment(audioId, 2, 26000, 40000, 44000);
    for (const q of [q21, q22]) await t.api("PATCH", `/topik/questions/${q.id}/segment`, { profile_id: adult, segment_id: shared });

    const audio = (await t.api("GET", `/topik/audio/${audioId}?profile_id=${adult}`)).body as { segments: { idx: number; questions: number[] }[] };
    // A dialogue carrying a pair: both questions point at the same clip.
    expect(audio.segments.map((s) => s.questions)).toEqual([[21, 22], []]);
  });

  it("edits a boundary without touching the mp3, and un-approves the exam", async () => {
    const audioId = await addAudio(true);
    const segmentId = await addSegment(audioId, 1, 1000, 20000, 26000);

    const res = await t.api("PATCH", `/topik/segments/${segmentId}`, { profile_id: adult, start_ms: 1500, speech_end_ms: 19000 });
    expect(res.status).toBe(200);
    const row = await t.env.DB.prepare("SELECT start_ms, speech_end_ms, end_ms FROM topik_segments WHERE id = ?").bind(segmentId).first();
    expect(row).toEqual({ start_ms: 1500, speech_end_ms: 19000, end_ms: 26000 });
    // The clips changed since they were checked, so the approval has to be earned again.
    expect(await t.env.DB.prepare("SELECT verified FROM topik_audio WHERE id = ?").bind(audioId).first()).toEqual({ verified: 0 });
  });

  it("keeps a listening question out of practice until its audio is approved", async () => {
    const q = await listening(1);
    const audioId = await addAudio();
    const segmentId = await addSegment(audioId, 1, 1000, 20000, 26000);
    await t.api("PATCH", `/topik/questions/${q.id}/segment`, { profile_id: adult, segment_id: segmentId });

    const session = async () =>
      ((await t.api("GET", `/topik/session?profile_id=${adult}&section=listening&from=1&to=3`)).body as { questions: unknown[] }).questions;
    expect(await session()).toHaveLength(0);

    await t.api("PATCH", `/topik/audio/${audioId}`, { profile_id: adult, verified: true });
    expect(await session()).toHaveLength(1);
  });

  it("keeps a listening question with no clip out of practice even when the audio is approved", async () => {
    await listening(1); // never linked to a segment
    const audioId = await addAudio(true);
    await addSegment(audioId, 1, 1000, 20000, 26000);
    const session = (await t.api("GET", `/topik/session?profile_id=${adult}&section=listening&from=1&to=3`)).body as { questions: unknown[] };
    expect(session.questions).toHaveLength(0);
  });

  // Reading has no audio; the new gate must not touch it.
  it("does not apply the audio gate to reading questions", async () => {
    await createQuestion({ number: 1 });
    const session = (await t.api("GET", `/topik/session?profile_id=${adult}&section=reading&from=1&to=3`)).body as { questions: unknown[] };
    expect(session.questions).toHaveLength(1);
  });

  // The picker must not promise work that practice cannot serve: a listening block is counted only
  // once its questions have a clip and the exam's audio has been approved.
  it("counts a listening block only once its audio is usable", async () => {
    const q = await listening(1);
    const audioId = await addAudio();
    const segmentId = await addSegment(audioId, 1, 1000, 20000, 26000);
    const blocks = async () =>
      (await t.api("GET", `/topik/blocks?section=listening&profile_id=${adult}`)).body as { block: string; count: number }[];

    expect(await blocks()).toEqual([]); // no clip yet
    await t.api("PATCH", `/topik/questions/${q.id}/segment`, { profile_id: adult, segment_id: segmentId });
    expect(await blocks()).toEqual([]); // clip, but the audio is not approved
    await t.api("PATCH", `/topik/audio/${audioId}`, { profile_id: adult, verified: true });
    expect(await blocks()).toMatchObject([{ block: "1~3", count: 1 }]);
  });

  it("is adult-only", async () => {
    const audioId = await addAudio();
    expect((await t.api("GET", `/topik/audio?profile_id=${kid}`)).status).toBe(403);
    expect((await t.api("GET", `/topik/audio/${audioId}?profile_id=${kid}`)).status).toBe(403);
    expect((await t.api("PATCH", `/topik/audio/${audioId}`, { profile_id: kid, verified: true })).status).toBe(403);
  });

  it("404s on an unknown audio or segment", async () => {
    expect((await t.api("GET", `/topik/audio/nope?profile_id=${adult}`)).status).toBe(404);
    expect((await t.api("PATCH", "/topik/segments/nope", { profile_id: adult, start_ms: 0 })).status).toBe(404);
  });
});

// M7.1: the stem of a listening question is its transcript, typed in the same Word table. Sending
// it (or the vocabulary built from it) before the learner answers would turn a listening exercise
// into a reading one, so the server withholds both — hiding them in the UI would not be enough.
describe("listening transcript", () => {
  const setup = async (stemText: string | null = "남자: 어디에 가요?") => {
    const q = await createQuestion({ section: "listening", exam: "Listen-60회", number: 1, block: "1~3", stem: { text: stemText, image_key: null } });
    const audioId = crypto.randomUUID();
    const segmentId = crypto.randomUUID();
    const now = Date.now();
    await t.env.DB.prepare(
      `INSERT INTO topik_audio (id, section, exam, audio_key, duration_ms, verified, created_at, updated_at)
       VALUES (?, 'listening', 'Listen-60회', 'topik/audio/${"b".repeat(40)}.mp3', 600000, 1, ?, ?)`,
    ).bind(audioId, now, now).run();
    await t.env.DB.prepare(
      "INSERT INTO topik_segments (id, audio_id, idx, start_ms, speech_end_ms, end_ms, created_at) VALUES (?, ?, 1, 1000, 20000, 26000, ?)",
    ).bind(segmentId, audioId, now).run();
    await t.env.DB.prepare("UPDATE topik_questions SET segment_id = ?, vocab = ?, vocab_checked_at = ? WHERE id = ?")
      .bind(segmentId, JSON.stringify([{ surface: "어디", lemma: "어디", pos: "pronoun", gloss_vi: "ở đâu" }]), now, q.id)
      .run();
    return q;
  };
  const session = async () =>
    ((await t.api("GET", `/topik/session?profile_id=${adult}&section=listening&from=1&to=3`)).body as {
      questions: { stem: { text: string | null }; vocab: unknown[]; audio: Record<string, unknown> | null }[];
    }).questions;

  it("never sends the transcript or its vocabulary with the question", async () => {
    await setup();
    const [question] = await session();
    expect(question!.stem.text).toBeNull();
    expect(question!.vocab).toEqual([]);
  });

  it("sends the clip to play instead", async () => {
    await setup();
    const [question] = await session();
    expect(question!.audio).toEqual({ audio_key: `topik/audio/${"b".repeat(40)}.mp3`, start_ms: 1000, speech_end_ms: 20000, end_ms: 26000 });
  });

  it("returns the transcript and its vocabulary with the attempt result", async () => {
    const q = await setup();
    const res = await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 1, duration_ms: 1000 });
    expect(res.body).toMatchObject({ transcript: "남자: 어디에 가요?", vocab: [{ lemma: "어디" }] });
  });

  it("keeps the polled content free of the vocabulary until the question has been answered", async () => {
    const q = await setup();
    const content = async (profileId: string) =>
      (await t.api("GET", `/topik/questions/${q.id}/content?profile_id=${profileId}`)).body as { vocab: unknown[]; vocab_ready: boolean };

    expect(await content(adult)).toMatchObject({ vocab: [], vocab_ready: true });
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 1, duration_ms: 1000 });
    expect((await content(adult)).vocab).toHaveLength(1);
    // Another profile has not answered it yet, so it still gets nothing.
    expect((await content(kid)).vocab).toEqual([]);
  });

  // Reading stems were always meant to be read; the new rule must not touch them.
  it("still sends a reading question's stem and vocabulary up front", async () => {
    const q = await createQuestion({ number: 1, stem: { text: "읽기 지문", image_key: null } });
    await t.env.DB.prepare("UPDATE topik_questions SET vocab = ?, vocab_checked_at = ? WHERE id = ?")
      .bind(JSON.stringify([{ surface: "지문", lemma: "지문", pos: "noun", gloss_vi: "đoạn văn" }]), Date.now(), q.id)
      .run();
    const questions = ((await t.api("GET", `/topik/session?profile_id=${adult}&section=reading&from=1&to=3`)).body as {
      questions: { stem: { text: string | null }; vocab: unknown[]; audio: unknown }[];
    }).questions;
    expect(questions[0]).toMatchObject({ stem: { text: "읽기 지문" }, audio: null });
    expect(questions[0]!.vocab).toHaveLength(1);
    const attempt = await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: q.id, selected_option: 1, duration_ms: 1 });
    expect((attempt.body as { transcript: string | null }).transcript).toBeNull();
  });
});

// M7.1: the review screen reviews one section at a time — ~230 reading rows would bury the
// listening ones, and their exam labels and blocks have nothing to do with each other.
describe("review list filtered by section", () => {
  const setup = async () => {
    await createQuestion({ number: 1, exam: "Read-연습1" });
    await createQuestion({ section: "listening", exam: "Listen-35회", number: 1, block: "1~3" });
    await createQuestion({ section: "listening", exam: "Listen-36회", number: 1, block: "1~3" });
  };
  const list = async (section?: string) =>
    (await t.api("GET", `/topik/questions?profile_id=${adult}${section ? `&section=${section}` : ""}`)).body as {
      questions: { section: string; exam: string }[];
      total: number;
    };

  it("returns only the asked-for section", async () => {
    await setup();
    expect((await list("listening")).questions.map((q) => q.exam).sort()).toEqual(["Listen-35회", "Listen-36회"]);
    expect((await list("reading")).questions.map((q) => q.exam)).toEqual(["Read-연습1"]);
    expect((await list()).total).toBe(3); // no section: everything, as before
  });

  it("scopes the exam/block dropdowns to the section as well", async () => {
    await setup();
    const facets = async (section: string) =>
      (await t.api("GET", `/topik/questions/facets?profile_id=${adult}&section=${section}`)).body as { exams: string[]; blocks: string[] };
    expect((await facets("listening")).exams).toEqual(["Listen-35회", "Listen-36회"]);
    expect((await facets("reading")).exams).toEqual(["Read-연습1"]);
  });

  // The row has to say whether a clip is attached, and the "Xem" screen plays it from here.
  it("carries each listening question's clip so the review screen can play it", async () => {
    const q = await createQuestion({ section: "listening", exam: "Listen-35회", number: 1, block: "1~3" });
    const audioId = crypto.randomUUID();
    const segmentId = crypto.randomUUID();
    const now = Date.now();
    await t.env.DB.prepare(
      `INSERT INTO topik_audio (id, section, exam, audio_key, duration_ms, verified, created_at, updated_at)
       VALUES (?, 'listening', 'Listen-35회', 'topik/audio/${"c".repeat(40)}.mp3', 600000, 0, ?, ?)`,
    ).bind(audioId, now, now).run();
    await t.env.DB.prepare(
      "INSERT INTO topik_segments (id, audio_id, idx, start_ms, speech_end_ms, end_ms, created_at) VALUES (?, ?, 1, 1000, 20000, 26000, ?)",
    ).bind(segmentId, audioId, now).run();

    const before = (await t.api("GET", `/topik/questions?profile_id=${adult}&section=listening`)).body as { questions: { audio: unknown }[] };
    expect(before.questions[0]!.audio).toBeNull();

    await t.api("PATCH", `/topik/questions/${q.id}/segment`, { profile_id: adult, segment_id: segmentId });
    const after = (await t.api("GET", `/topik/questions?profile_id=${adult}&section=listening`)).body as { questions: { audio: unknown }[] };
    expect(after.questions[0]!.audio).toEqual({ audio_key: `topik/audio/${"c".repeat(40)}.mp3`, start_ms: 1000, speech_end_ms: 20000, end_ms: 26000 });
  });

  it("leaves a reading question's clip null", async () => {
    await createQuestion({ number: 1 });
    const body = (await t.api("GET", `/topik/questions?profile_id=${adult}&section=reading`)).body as { questions: { audio: unknown }[] };
    expect(body.questions[0]!.audio).toBeNull();
  });
});

// M7.5: two questions about one recording are one screen, answered in either order. The payload is
// where this is decided, not the screen: anything sent to the device has already left the server.
describe("a pair of questions sharing one clip", () => {
  const pair = async () => {
    const q21 = await createQuestion({ section: "listening", exam: "Listen-70회", number: 21, block: "21~22", stem: { text: "남자: 자전거로 출근해요.", image_key: null } });
    const q22 = await createQuestion({ section: "listening", exam: "Listen-70회", number: 22, block: "21~22", stem: { text: "남자: 자전거로 출근해요.", image_key: null } });
    const audioId = crypto.randomUUID();
    const segmentId = crypto.randomUUID();
    const now = Date.now();
    await t.env.DB.prepare(
      `INSERT INTO topik_audio (id, section, exam, audio_key, duration_ms, verified, created_at, updated_at)
       VALUES (?, 'listening', 'Listen-70회', 'topik/audio/${"c".repeat(40)}.mp3', 600000, 1, ?, ?)`,
    ).bind(audioId, now, now).run();
    await t.env.DB.prepare(
      "INSERT INTO topik_segments (id, audio_id, idx, start_ms, speech_end_ms, end_ms, created_at) VALUES (?, ?, 21, 1000, 20000, 26000, ?)",
    ).bind(segmentId, audioId, now).run();
    for (const [number, q] of [[21, q21], [22, q22]] as const) {
      await t.env.DB.prepare("UPDATE topik_questions SET segment_id = ?, explanation_vi = ?, explain_checked_at = ? WHERE id = ?")
        .bind(segmentId, `giải thích câu ${number}`, now, q.id)
        .run();
    }
    return { q21, q22, segmentId };
  };

  const answer = async (questionId: string, selected: number, group_pending: boolean) =>
    (await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: questionId, selected_option: selected, group_pending })).body as {
      is_correct: boolean;
      correct_option: number;
      transcript: string | null;
      vocab: unknown[];
      explanation_vi: string | null;
      group_reveal: { question_id: string; number: number; transcript: string | null; explanation_vi: string | null }[];
    };

  it("gives both questions of the pair the same group", async () => {
    const { q21, q22, segmentId } = await pair();
    const questions = ((await t.api("GET", `/topik/session?profile_id=${adult}&section=listening&from=21&to=22`)).body as {
      questions: { id: string; group_id: string }[];
    }).questions;
    expect(questions.map((q) => q.group_id)).toEqual([segmentId, segmentId]);
    expect(questions.map((q) => q.id)).toEqual([q21.id, q22.id]);
  });

  // The one that matters: answering the first half must not hand over the recording's words.
  it("withholds the transcript and the explanation while the other half is unanswered", async () => {
    const { q21 } = await pair();
    const res = await answer(q21.id, 1, true);
    expect(res.transcript).toBeNull();
    expect(res.explanation_vi).toBeNull();
    expect(res.vocab).toEqual([]);
    expect(res.group_reveal).toEqual([]);
    // The verdict for this question is still given — knowing 21 is wrong says nothing about 22.
    expect(res).toMatchObject({ is_correct: false, correct_option: 3 });
    expect(JSON.stringify(res)).not.toContain("자전거");
  });

  it("reveals the whole pair once the second half is answered", async () => {
    const { q21, q22 } = await pair();
    await answer(q21.id, 1, true);
    const res = await answer(q22.id, 3, false);
    expect(res.transcript).toBe("남자: 자전거로 출근해요.");
    expect(res.group_reveal.map((r) => r.number)).toEqual([21, 22]);
    expect(res.group_reveal.map((r) => r.explanation_vi)).toEqual(["giải thích câu 21", "giải thích câu 22"]);
  });

  it("reveals a lone question's own group of one", async () => {
    const q = await createQuestion({ section: "reading", number: 5, block: "5~8" });
    const res = await answer(q.id, 3, false);
    expect(res.group_reveal).toHaveLength(1);
    expect(res.group_reveal[0]).toMatchObject({ question_id: q.id, number: 5 });
  });

  // Giving up: the learner asks for the recording's words instead of answering.
  it("hands over the whole group on reveal, and writes nothing", async () => {
    const { q21, q22 } = await pair();
    const before = await t.env.DB.prepare("SELECT count(*) AS n FROM topik_attempts").first<{ n: number }>();
    const res = (await t.api("GET", `/topik/questions/${q21.id}/reveal?profile_id=${adult}`)).body as {
      group: { question_id: string; number: number; transcript: string | null; correct_option: number }[];
    };
    expect(res.group.map((r) => r.number)).toEqual([21, 22]);
    expect(res.group[0]!.transcript).toBe("남자: 자전거로 출근해요.");
    expect(res.group.map((r) => r.question_id)).toEqual([q21.id, q22.id]);
    const after = await t.env.DB.prepare("SELECT count(*) AS n FROM topik_attempts").first<{ n: number }>();
    const cards = await t.env.DB.prepare("SELECT count(*) AS n FROM topik_cards").first<{ n: number }>();
    expect([after!.n, cards!.n]).toEqual([before!.n, 0]);
  });
});
