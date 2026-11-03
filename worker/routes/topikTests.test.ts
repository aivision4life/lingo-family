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

type OptionsBody = {
  papers: {
    exam: string;
    ready_questions: number;
    contiguous: boolean;
    lengths: { length: number | string; available: boolean; questions: number }[];
    history: { score_points: number; total_points: number; correct_count: number }[];
  }[];
  mixed: {
    ready_questions: number;
    reachable: number;
    lengths: { length: number | string; available: boolean; questions: number; missing_position: number | null }[];
    history: { score_points: number }[];
  } | null;
};

const options = async (profile = adult) =>
  (await t.api("GET", `/topik/tests/options?profile_id=${profile}&section=listening`)).body as OptionsBody;

describe("mock test", () => {
  it("offers a paper's lengths, disabling the ones it cannot fill", async () => {
    for (const n of [1, 2, 3]) await question(n);
    const body = await options();
    expect(body.papers).toHaveLength(1);
    expect(body.papers[0]).toMatchObject({ exam: "Test-35회", ready_questions: 3, contiguous: true, history: [] });
    expect(body.papers[0]!.lengths).toEqual([
      { length: 20, available: false, questions: 20 },
      { length: 30, available: false, questions: 30 },
      { length: "full", available: true, questions: 3 },
    ]);
  });

  /**
   * The size that broke production (M6.4). Every other test here sits at three questions, which
   * binds 21 parameters; a 20-question paper binds 140 and D1 refuses any statement over 100, so
   * the suite could not have caught it at its usual scale. A real paper is 50 questions, and the
   * only reason this test stops at 20 is how long creating the rows takes.
   */
  it("creates a sitting far past D1's 100-parameter ceiling", async () => {
    for (const n of Array.from({ length: 20 }, (_, i) => i + 1)) await question(n);
    const test = await start();
    expect(test.question_count).toBe(20);
    expect(test.questions.map((q) => q.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

    const items = await t.env.DB.prepare("SELECT count(*) AS n FROM topik_test_items WHERE test_id = ?").bind(test.id).first<{ n: number }>();
    expect(items!.n).toBe(20);
  }, 30_000);

  it("leaves no half-made sitting behind when the questions cannot be written", async () => {
    await question(1);
    const test = await start();
    // The row and its items arrive together or not at all: a test row with no questions is a
    // sitting that exists and cannot be taken, which is what every failed attempt used to leave.
    const tests = await t.env.DB.prepare(
      "SELECT count(*) AS n FROM topik_tests WHERE (SELECT count(*) FROM topik_test_items i WHERE i.test_id = topik_tests.id) = 0",
    ).first<{ n: number }>();
    expect([test.question_count, tests!.n]).toEqual([1, 0]);
  });

  it("offers nothing for a paper with a hole in its numbering", async () => {
    for (const n of [1, 3]) await question(n);
    const body = await options();
    expect(body.papers[0]!.contiguous).toBe(false);
    expect(body.papers[0]!.lengths.every((l) => !l.available)).toBe(true);
  });

  it("ignores a question whose exam's audio is not approved yet", async () => {
    await question(1);
    await t.env.DB.prepare("UPDATE topik_audio SET verified = 0").run();
    expect(await options()).toEqual({ papers: [], mixed: null });
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

    expect((await options()).papers[0]!.history).toMatchObject([{ score_points: 2, total_points: 2, correct_count: 1 }]);
    // Another profile's history is its own.
    expect((await options(other)).papers[0]!.history).toEqual([]);
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

describe("mixed mock test (M6.5)", () => {
  type MixedRun = {
    id: string;
    kind: string;
    source_exam: string | null;
    audio: unknown;
    question_count: number;
    questions: { position: number; number: number; exam: string; clip: { audio_key: string; start_ms: number } | null }[];
  };

  const startMixed = async (length: number | "full" = "full", profile = adult) =>
    await t.api("POST", "/topik/tests", { profile_id: profile, section: "listening", kind: "mixed", length });

  const mixedRun = async (length: number | "full" = "full", profile = adult) => (await startMixed(length, profile)).body as MixedRun;

  /** Two papers covering the same question numbers — the bank a mixed draw needs. */
  const twoPapers = async (numbers: number[]) => {
    for (const n of numbers) await question(n, { exam: "Test-35회" });
    for (const n of numbers) await question(n, { exam: "Test-41회" });
  };

  it("offers the mixed card with how far the bank reaches", async () => {
    await twoPapers([1, 2, 3]);
    const body = await options();
    expect(body.mixed).toMatchObject({ ready_questions: 6, reachable: 3, history: [] });
    expect(body.mixed!.lengths).toEqual([
      { length: 20, available: false, questions: 20, missing_position: 4 },
      { length: 30, available: false, questions: 30, missing_position: 4 },
      { length: "full", available: true, questions: 3, missing_position: null },
    ]);
  });

  it("has no mixed card for reading, which has no clips to draw", async () => {
    await twoPapers([1]);
    const body = (await t.api("GET", `/topik/tests/options?profile_id=${adult}&section=reading`)).body as OptionsBody;
    expect(body.mixed).toBeNull();
  });

  it("creates a sitting with no paper of its own and a clip on every question", async () => {
    await twoPapers([1, 2, 3]);
    const run = await mixedRun();
    expect(run).toMatchObject({ kind: "mixed", source_exam: null, audio: null, question_count: 3 });
    expect(run.questions.map((q) => q.position)).toEqual([1, 2, 3]);
    expect(run.questions.every((q) => q.clip !== null)).toBe(true);
    // Each question says which paper it came from: in a mixed sitting that changes question to
    // question, and it is the only way back to the original later.
    expect(run.questions.every((q) => q.exam.startsWith("Test-"))).toBe(true);
  });

  it("never sends a transcript or an answer while a mixed sitting runs", async () => {
    await twoPapers([1]);
    const run = await mixedRun();
    expect(JSON.stringify(run)).not.toContain("안녕하세요");
    expect(JSON.stringify(run)).not.toContain("correct_option");
  });

  it("prefers the paper the profile has not just sat", async () => {
    await twoPapers([1, 2, 3]);
    const first = await mixedRun();
    await t.api("POST", `/topik/tests/${first.id}/finish`, { profile_id: adult, duration_ms: 1000, pause_count: 0, paused_ms: 0 });

    // Every position has exactly one alternative, and the first sitting's questions are all seen
    // now (it was finished, so the tape played them all): the second sitting must be the mirror.
    const second = await mixedRun();
    for (const q of second.questions) {
      expect(q.exam).not.toBe(first.questions.find((f) => f.position === q.position)!.exam);
    }
  });

  it("counts only the answered questions of an abandoned sitting as seen", async () => {
    await twoPapers([1, 2, 3]);
    const first = await mixedRun();
    await t.api("PUT", `/topik/tests/${first.id}/items/1`, { profile_id: adult, selected_option: 2 });
    await t.api("POST", `/topik/tests/${first.id}/abandon`, { profile_id: adult });

    // The tape stopped at question 1. Only that question was really met, so only that position is
    // forced to the other paper; the rest were never heard and stay free to be drawn again.
    const second = await mixedRun();
    expect(second.questions[0]!.exam).not.toBe(first.questions[0]!.exam);
  });

  it("keeps each profile's own seen list", async () => {
    await twoPapers([1]);
    const mine = await mixedRun();
    await t.api("POST", `/topik/tests/${mine.id}/finish`, { profile_id: adult, duration_ms: 1000, pause_count: 0, paused_ms: 0 });
    // The other profile has sat nothing, so the question I just answered is still new to them and
    // either paper is fair game — what must not happen is my history steering their draw.
    const theirs = await mixedRun("full", other);
    expect(theirs.questions).toHaveLength(1);
  });

  it("says which question the bank is missing instead of a short test", async () => {
    await twoPapers([1, 2, 3]);
    const res = await startMixed(20);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "topik_test_bank_short", missing_position: 4 });
  });

  it("refuses a mixed draw from an empty bank", async () => {
    const res = await startMixed("full");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "topik_test_bank_short", missing_position: 1 });
  });

  it("lists a finished mixed sitting in the mixed history, not in a paper's", async () => {
    await twoPapers([1]);
    const run = await mixedRun();
    await t.api("POST", `/topik/tests/${run.id}/finish`, { profile_id: adult, duration_ms: 1000, pause_count: 0, paused_ms: 0 });
    const body = await options();
    expect(body.mixed!.history).toHaveLength(1);
    expect(body.papers.every((p) => p.history.length === 0)).toBe(true);
  });

  it("names every item's source paper in the result", async () => {
    await twoPapers([1, 2]);
    const run = await mixedRun();
    const result = (await t.api("POST", `/topik/tests/${run.id}/finish`, { profile_id: adult, duration_ms: 1000, pause_count: 0, paused_ms: 0 }))
      .body as { kind: string; items: { position: number; exam: string | null }[] };
    expect(result.kind).toBe("mixed");
    for (const item of result.items) {
      expect(item.exam).toBe(run.questions.find((q) => q.position === item.position)!.exam);
    }
  });

  it("refuses an original sitting with no paper named", async () => {
    await twoPapers([1]);
    expect((await t.api("POST", "/topik/tests", { profile_id: adult, section: "listening", length: "full" })).status).toBe(400);
  });
});

// M7.5: from question 21 one recording carries two questions, and the sitting shows them on one
// screen. The payload is what makes that possible: both must name the same group.
describe("a pair sharing one clip in a sitting", () => {
  it("gives both questions the clip as their group, and a lone question its own", async () => {
    await question(1);
    const id2 = await question(2);
    const id3 = await question(3);
    // Point question 3 at question 2's clip, as a paired question is pointed in a real paper.
    const segment = await t.env.DB.prepare("SELECT segment_id AS s FROM topik_questions WHERE id = ?").bind(id2).first<{ s: string }>();
    await t.env.DB.prepare("UPDATE topik_questions SET segment_id = ? WHERE id = ?").bind(segment!.s, id3).run();

    const run = (await t.api("POST", "/topik/tests", { profile_id: adult, section: "listening", exam: "Test-35회", length: "full" })).body as {
      questions: { number: number; group_id: string }[];
    };
    const byNumber = new Map(run.questions.map((q) => [q.number, q.group_id]));
    expect(byNumber.get(2)).toBe(segment!.s);
    expect(byNumber.get(3)).toBe(segment!.s);
    // Question 1 has a clip of its own, so it is a group of one — a different id from the pair's.
    expect(byNumber.get(1)).not.toBe(segment!.s);
  });
});
