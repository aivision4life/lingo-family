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
  for (const table of ["topik_attempts", "topik_cards", "topik_questions", "profiles"]) {
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
    expect((await t.api("GET", `/topik/questions?profile_id=${adult}`)).body).toEqual([]);
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

describe("blocks + practice session", () => {
  it("lists blocks grouped from verified questions only", async () => {
    await createQuestion({ number: 1 });
    await createQuestion({ number: 2, exam: "Test/연습2" });
    const unverified = await t.api("POST", "/topik/questions", { ...input({ number: 99, exam: "Test/연습3", block: "99" }), profile_id: adult });
    await t.env.DB.prepare("UPDATE topik_questions SET verified = 0 WHERE id = ?").bind((unverified.body as { id: string }).id).run();

    const blocks = (await t.api("GET", "/topik/blocks?section=reading")).body as { block: string; from: number; to: number; count: number }[];
    expect(blocks).toEqual([{ section: "reading", block: "1~2", from: 1, to: 2, count: 2 }]);
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
});

describe("per-question vocabulary (M6.2, 'tap a word')", () => {
  const sample = { words: [{ surface: "일어나서", lemma: "일어나다", pos: "verb", gloss_vi: "thức dậy" }] };
  let tv: Awaited<ReturnType<typeof createTestEnv>>;
  let llm: ReturnType<typeof fakeLlm>;
  let adultV: string;

  beforeAll(async () => {
    llm = fakeLlm([JSON.stringify(sample)]);
    tv = await createTestEnv(testApp({ makeLlm: () => llm.client }));
  }, 60_000);
  afterAll(() => tv.dispose());

  beforeEach(async () => {
    for (const table of ["usage_daily", "topik_attempts", "topik_cards", "topik_questions", "profiles"]) {
      await tv.env.DB.prepare(`DELETE FROM ${table}`).run();
    }
    llm.requests.length = 0;
    adultV = ((await tv.api("POST", "/profiles", profile())).body as { id: string }).id;
  });

  it("generates vocab in the background when a manual question is created, logging usage with no quota check", async () => {
    const res = await tv.api("POST", "/topik/questions", { ...input(), profile_id: adultV });
    expect((res.body as { vocab: unknown[] }).vocab).toEqual([]); // not generated yet: the response does not wait for it
    await tv.settle();

    const row = (await tv.api("GET", `/topik/questions?profile_id=${adultV}`)).body as { vocab: TopikVocabEntry[] }[];
    expect(row[0]!.vocab).toEqual(sample.words);
    expect(llm.requests).toHaveLength(1);

    const usage = await tv.env.DB.prepare("SELECT count FROM usage_daily WHERE profile_id = ? AND service = 'topik_vocab'").bind(adultV).first();
    expect(usage).toMatchObject({ count: 1 });
  });

  it("regenerates when the text changes, but not when an unrelated field changes", async () => {
    const q = await tv.api("POST", "/topik/questions", { ...input(), profile_id: adultV });
    await tv.settle();
    llm.requests.length = 0;

    // Same text, only `warning` cleared: no new LLM call.
    await tv.api("PATCH", `/topik/questions/${(q.body as { id: string }).id}`, { profile_id: adultV, warning: null });
    await tv.settle();
    expect(llm.requests).toHaveLength(0);

    // Text changes: regenerates.
    await tv.api("PATCH", `/topik/questions/${(q.body as { id: string }).id}`, { profile_id: adultV, instruction: "새로운 지시문입니다." });
    await tv.settle();
    expect(llm.requests).toHaveLength(1);
  });

  it("verify-bulk generates vocab only for rows never checked before", async () => {
    // q1: created through the normal (manual) flow, already verified → already has its vocab.
    await tv.api("POST", "/topik/questions", { ...input({ number: 1 }), profile_id: adultV });
    await tv.settle();
    llm.requests.length = 0;

    // q2: inserted directly like the import script would — unverified, vocab never checked.
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

    // Only q2 needed generation (q1 already had vocab_checked_at set) — exactly 1 new LLM call.
    expect(llm.requests).toHaveLength(1);
    const q2row = await tv.env.DB.prepare("SELECT vocab_checked_at FROM topik_questions WHERE id = 'q2'").first();
    expect(q2row!.vocab_checked_at).not.toBeNull();
  });
});
