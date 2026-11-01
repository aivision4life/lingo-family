// Mock test lifecycle (M6.4) against a real local D1. The two promises worth testing here are the
// ones that would be silent failures: a running test must never leak the answers, and abandoning
// one must leave the FSRS schedule exactly as it was.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TopikQuestionInput } from "../../shared/topik";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult = "";
let other = "";

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());

const profile = (over: Record<string, unknown> = {}) => ({
  name: "Bố",
  avatar: "🐻",
  ui_lang: "vi",
  gloss_lang: "vi",
  is_kid: false,
  daily_new_limit: 10,
  study_langs: ["ko"],
  ...over,
});

const input = (over: Partial<TopikQuestionInput> = {}): TopikQuestionInput => ({
  section: "listening",
  exam: "Test-35회",
  number: 1,
  block: "1~3",
  instruction: "다음을 듣고 알맞은 그림을 고르십시오. (각 2점)",
  points: 2,
  stem: { text: "남자: 안녕하세요.", image_key: null },
  options: [{ text: "1", image_key: null }, { text: "2", image_key: null }, { text: "3", image_key: null }, { text: "4", image_key: null }],
  correct_option: 2,
  ...over,
});

/** A listening question with an approved clip — the only kind a test can use. */
async function question(number: number, over: Partial<TopikQuestionInput> = {}) {
  const created = (await t.api("POST", "/topik/questions", { ...input({ number, ...over }), profile_id: adult })).body as { id: string };
  const audio = await t.env.DB.prepare("SELECT id FROM topik_audio WHERE exam = ?").bind(over.exam ?? "Test-35회").first<{ id: string }>();
  let audioId = audio?.id;
  if (!audioId) {
    audioId = crypto.randomUUID();
    await t.env.DB.prepare(
      "INSERT INTO topik_audio (id, section, exam, audio_key, duration_ms, verified, created_at, updated_at) VALUES (?, 'listening', ?, 'topik/audio/x.mp3', 600000, 1, ?, ?)",
    )
      .bind(audioId, over.exam ?? "Test-35회", Date.now(), Date.now())
      .run();
  }
  const segmentId = crypto.randomUUID();
  const start = (number - 1) * 60_000;
  await t.env.DB.prepare(
    "INSERT INTO topik_segments (id, audio_id, idx, start_ms, speech_end_ms, end_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(segmentId, audioId, number, start, start + 40_000, start + 60_000, Date.now())
    .run();
  await t.env.DB.prepare("UPDATE topik_questions SET segment_id = ? WHERE id = ?").bind(segmentId, created.id).run();
  return created.id;
}

beforeEach(async () => {
  for (const table of ["topik_test_items", "topik_tests", "topik_attempts", "topik_cards", "topik_segments", "topik_audio", "topik_questions", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  adult = ((await t.api("POST", "/profiles", profile())).body as { id: string }).id;
  other = ((await t.api("POST", "/profiles", profile({ name: "Mẹ" }))).body as { id: string }).id;
});

const start = async (length: number | "full" = "full") =>
  (await t.api("POST", "/topik/tests", { profile_id: adult, section: "listening", exam: "Test-35회", length })).body as {
    id: string;
    audio: { audio_key: string; start_ms: number; end_ms: number } | null;
    question_count: number;
    total_points: number;
    questions: { position: number; number: number; stem: { text: string | null }; points: number }[];
  };

describe("mock test", () => {
  it("offers a paper's lengths, disabling the ones it cannot fill", async () => {
    for (const n of [1, 2, 3]) await question(n);
    const options = (await t.api("GET", `/topik/tests/options?profile_id=${adult}&section=listening`)).body as {
      exam: string;
      ready_questions: number;
      contiguous: boolean;
      lengths: { length: number | string; available: boolean; questions: number }[];
      history: unknown[];
    }[];
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ exam: "Test-35회", ready_questions: 3, contiguous: true, history: [] });
    expect(options[0]!.lengths).toEqual([
      { length: 20, available: false, questions: 20 },
      { length: 30, available: false, questions: 30 },
      { length: "full", available: true, questions: 3 },
    ]);
  });

  it("offers nothing for a paper with a hole in its numbering", async () => {
    for (const n of [1, 3]) await question(n);
    const options = (await t.api("GET", `/topik/tests/options?profile_id=${adult}&section=listening`)).body as {
      contiguous: boolean;
      lengths: { available: boolean }[];
    }[];
    expect(options[0]!.contiguous).toBe(false);
    expect(options[0]!.lengths.every((l) => !l.available)).toBe(true);
  });

  it("ignores a question whose exam's audio is not approved yet", async () => {
    await question(1);
    await t.env.DB.prepare("UPDATE topik_audio SET verified = 0").run();
    const options = (await t.api("GET", `/topik/tests/options?profile_id=${adult}&section=listening`)).body as unknown[];
    expect(options).toEqual([]);
  });

  it("creates a sitting whose audio is one span from the first clip to the last", async () => {
    for (const n of [1, 2, 3]) await question(n);
    const test = await start();
    expect(test.question_count).toBe(3);
    expect(test.total_points).toBe(6);
    expect(test.audio).toEqual({ audio_key: "topik/audio/x.mp3", start_ms: 0, end_ms: 180_000 });
    expect(test.questions.map((q) => q.number)).toEqual([1, 2, 3]);
  });

  it("never sends a listening question's transcript while the test is running", async () => {
    await question(1);
    const test = await start();
    // The stem text of a listening question IS the transcript: having it in the payload would be
    // the answer, however well the screen hides it.
    expect(test.questions[0]!.stem.text).toBeNull();
    expect(JSON.stringify(test)).not.toContain("correct_option");

    const reopened = (await t.api("GET", `/topik/tests/${test.id}?profile_id=${adult}`)).body as { questions: { stem: { text: string | null } }[] };
    expect(reopened.questions[0]!.stem.text).toBeNull();
  });

  it("saves answers as they are given, and the latest one wins", async () => {
    await question(1);
    const test = await start();
    await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 3 });
    await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 2 });
    const row = await t.env.DB.prepare("SELECT selected_option FROM topik_test_items WHERE test_id = ?").bind(test.id).first<{ selected_option: number }>();
    expect(row!.selected_option).toBe(2);
  });

  it("applies answers that never reached the server, so a dropped request costs no mark", async () => {
    for (const n of [1, 2]) await question(n);
    const test = await start();
    // Only question 1 got through while the tape ran; question 2 rides along with the submit.
    await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 2 });
    const result = (await t.api("POST", `/topik/tests/${test.id}/finish`, {
      profile_id: adult,
      duration_ms: 120_000,
      pause_count: 0,
      paused_ms: 0,
      answers: [{ position: 2, selected_option: 2 }],
    })).body as { correct_count: number; score_points: number; total_points: number; items: { position: number; is_correct: boolean }[] };
    expect(result.correct_count).toBe(2);
    expect(result).toMatchObject({ score_points: 4, total_points: 4 });
  });

  it("grades, scores by points, and reveals the answers only once finished", async () => {
    await question(1);
    await question(2, { correct_option: 4, points: 3 });
    const test = await start();
    await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 2 });
    await t.api("PUT", `/topik/tests/${test.id}/items/2`, { profile_id: adult, selected_option: 1 });

    const result = (await t.api("POST", `/topik/tests/${test.id}/finish`, {
      profile_id: adult,
      duration_ms: 90_000,
      pause_count: 2,
      paused_ms: 30_000,
    })).body as {
      status: string;
      correct_count: number;
      score_points: number;
      total_points: number;
      pause_count: number;
      items: { position: number; correct_option: number; selected_option: number | null; is_correct: boolean; transcript: string | null }[];
    };

    expect(result.status).toBe("finished");
    expect(result).toMatchObject({ correct_count: 1, score_points: 2, total_points: 5, pause_count: 2 });
    expect(result.items.map((i) => i.is_correct)).toEqual([true, false]);
    expect(result.items[1]!.correct_option).toBe(4);
    // The transcript is fair game now — it is what the question is learnt from.
    expect(result.items[0]!.transcript).toBe("남자: 안녕하세요.");
  });

  it("counts an unanswered position as wrong", async () => {
    await question(1);
    const test = await start();
    const result = (await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult, duration_ms: 1000, pause_count: 0, paused_ms: 0 }))
      .body as { correct_count: number; score_points: number; items: { selected_option: number | null }[] };
    expect(result).toMatchObject({ correct_count: 0, score_points: 0 });
    expect(result.items[0]!.selected_option).toBeNull();
  });

  it("feeds the FSRS schedule, with the attempts marked as scheduled", async () => {
    await question(1);
    const test = await start();
    await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 2 });
    await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult, duration_ms: 1000, pause_count: 0, paused_ms: 0 });

    const cards = (await t.env.DB.prepare("SELECT reps FROM topik_cards WHERE profile_id = ?").bind(adult).all<{ reps: number }>()).results;
    expect(cards).toHaveLength(1);
    // A timed sitting is a real recall test, so it counts towards the spacing like any review.
    const attempts = (
      await t.env.DB.prepare("SELECT scheduled, is_correct FROM topik_attempts WHERE profile_id = ?").bind(adult).all<{ scheduled: number; is_correct: number }>()
    ).results;
    expect(attempts).toEqual([{ scheduled: 1, is_correct: 1 }]);
  });

  it("leaves no trace when a sitting is abandoned", async () => {
    await question(1);
    const test = await start();
    await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 2 });
    await t.api("POST", `/topik/tests/${test.id}/abandon`, { profile_id: adult });

    const row = await t.env.DB.prepare("SELECT status, score_points FROM topik_tests WHERE id = ?").bind(test.id).first<{ status: string; score_points: number | null }>();
    expect(row).toEqual({ status: "abandoned", score_points: null });
    const cards = await t.env.DB.prepare("SELECT count(*) AS n FROM topik_cards").first<{ n: number }>();
    const attempts = await t.env.DB.prepare("SELECT count(*) AS n FROM topik_attempts").first<{ n: number }>();
    expect([cards!.n, attempts!.n]).toEqual([0, 0]);
  });

  it("never hands over the answer key for a cancelled sitting", async () => {
    await question(1);
    const test = await start();
    await t.api("POST", `/topik/tests/${test.id}/abandon`, { profile_id: adult });
    // Otherwise: start a test, cancel it, read every correct option off the result screen.
    const res = await t.api("GET", `/topik/tests/${test.id}?profile_id=${adult}`);
    expect(res.status).toBe(410);
    expect(JSON.stringify(res.body)).not.toContain("correct_option");
  });

  it("refuses to answer or finish a test that is over", async () => {
    await question(1);
    const test = await start();
    await t.api("POST", `/topik/tests/${test.id}/abandon`, { profile_id: adult });
    expect((await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 1 })).status).toBe(409);
    expect((await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult, duration_ms: 1, pause_count: 0, paused_ms: 0 })).status).toBe(409);
  });

  it("keeps one profile's sitting away from another", async () => {
    await question(1);
    const test = await start();
    expect((await t.api("GET", `/topik/tests/${test.id}?profile_id=${other}`)).status).toBe(404);
    expect((await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: other, selected_option: 1 })).status).toBe(404);
  });

  it("lists a finished sitting in the paper's history", async () => {
    await question(1);
    const test = await start();
    await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 2 });
    await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult, duration_ms: 1000, pause_count: 0, paused_ms: 0 });

    const options = (await t.api("GET", `/topik/tests/options?profile_id=${adult}&section=listening`)).body as {
      history: { score_points: number; total_points: number; correct_count: number }[];
    }[];
    expect(options[0]!.history).toMatchObject([{ score_points: 2, total_points: 2, correct_count: 1 }]);
    // Another profile's history is its own.
    const theirs = (await t.api("GET", `/topik/tests/options?profile_id=${other}&section=listening`)).body as { history: unknown[] }[];
    expect(theirs[0]!.history).toEqual([]);
  });

  it("keeps a sitting readable after its question is deleted", async () => {
    const id = await question(1);
    const test = await start();
    await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult, duration_ms: 1000, pause_count: 0, paused_ms: 0 });
    await t.api("DELETE", `/topik/questions/${id}`, { profile_id: adult });

    const result = (await t.api("GET", `/topik/tests/${test.id}?profile_id=${adult}`)).body as {
      question_count: number;
      items: { number: number; question_id: string | null }[];
    };
    expect(result.question_count).toBe(1);
    expect(result.items[0]).toMatchObject({ number: 1, question_id: null });
  });
});
