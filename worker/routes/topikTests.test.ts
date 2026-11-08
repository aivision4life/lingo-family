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
  // Time travel is on for the whole file so the clock tests can push a sitting past its deadline
  // (M7.13). It only makes the Worker honour an `X-Dev-Now` header, and no other test sends one.
  t = await createTestEnv(undefined, { DEV_TIME_TRAVEL: "1" });
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

/** How many questions one exam has ready — what the old "full" length meant (M7.14). */
const readyCount = async (exam = "Test-35회") =>
  (await t.env.DB.prepare("SELECT count(*) AS n FROM topik_questions WHERE exam = ?").bind(exam).first<{ n: number }>())!.n;

/** Questions 1..N of the paper; with no argument, the whole of it. */
const start = async (count?: number) =>
  (await t.api("POST", "/topik/tests", {
    profile_id: adult,
    section: "listening",
    exam: "Test-35회",
    from: 1,
    to: count ?? (await readyCount()),
  })).body as {
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
    })).body as {
      status: string;
      correct_count: number;
      score_points: number;
      total_points: number;
      pause_count: number;
      items: { position: number; correct_option: number; selected_option: number | null; is_correct: boolean; transcript: string | null }[];
    };

    expect(result.status).toBe("finished");
    expect(result).toMatchObject({ correct_count: 1, score_points: 2, total_points: 5 });
    expect(result.items.map((i) => i.is_correct)).toEqual([true, false]);
    expect(result.items[1]!.correct_option).toBe(4);
    // The transcript is fair game now — it is what the question is learnt from.
    expect(result.items[0]!.transcript).toBe("남자: 안녕하세요.");
  });

  it("counts an unanswered position as wrong", async () => {
    await question(1);
    const test = await start();
    const result = (await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult }))
      .body as { correct_count: number; score_points: number; items: { selected_option: number | null }[] };
    expect(result).toMatchObject({ correct_count: 0, score_points: 0 });
    expect(result.items[0]!.selected_option).toBeNull();
  });

  it("feeds the FSRS schedule, with the attempts marked as scheduled", async () => {
    await question(1);
    const test = await start();
    await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 2 });
    await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult });

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
    expect((await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult })).status).toBe(409);
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
    await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult });

    expect((await options()).papers[0]!.history).toMatchObject([{ score_points: 2, total_points: 2, correct_count: 1 }]);
    // Another profile's history is its own.
    expect((await options(other)).papers[0]!.history).toEqual([]);
  });

  it("keeps a sitting readable after its question is deleted", async () => {
    const id = await question(1);
    const test = await start();
    await t.api("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult });
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

  /** As far as the bank reaches: the distinct question numbers the papers cover (old "full"). */
  const mixedReach = async () =>
    (await t.env.DB.prepare("SELECT count(DISTINCT number) AS n FROM topik_questions WHERE section = 'listening'").first<{ n: number }>())!.n;

  const startMixed = async (count?: number, profile = adult) =>
    await t.api("POST", "/topik/tests", {
      profile_id: profile,
      section: "listening",
      kind: "mixed",
      from: 1,
      to: count ?? (await mixedReach()),
    });

  const mixedRun = async (count?: number, profile = adult) => (await startMixed(count, profile)).body as MixedRun;

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
    await t.api("POST", `/topik/tests/${first.id}/finish`, { profile_id: adult });

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
    await t.api("POST", `/topik/tests/${mine.id}/finish`, { profile_id: adult });
    // The other profile has sat nothing, so the question I just answered is still new to them and
    // either paper is fair game — what must not happen is my history steering their draw.
    const theirs = await mixedRun(undefined, other);
    expect(theirs.questions).toHaveLength(1);
  });

  it("says which question the bank is missing instead of a short test", async () => {
    await twoPapers([1, 2, 3]);
    const res = await startMixed(20);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "topik_test_bank_short", missing_position: 4 });
  });

  it("refuses a mixed draw from an empty bank", async () => {
    const res = await startMixed(1);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "topik_test_bank_short", missing_position: 1 });
  });

  it("lists a finished mixed sitting in the mixed history, not in a paper's", async () => {
    await twoPapers([1]);
    const run = await mixedRun();
    await t.api("POST", `/topik/tests/${run.id}/finish`, { profile_id: adult });
    const body = await options();
    expect(body.mixed!.history).toHaveLength(1);
    expect(body.papers.every((p) => p.history.length === 0)).toBe(true);
  });

  it("names every item's source paper in the result", async () => {
    await twoPapers([1, 2]);
    const run = await mixedRun();
    const result = (await t.api("POST", `/topik/tests/${run.id}/finish`, { profile_id: adult }))
      .body as { kind: string; items: { position: number; exam: string | null }[] };
    expect(result.kind).toBe("mixed");
    for (const item of result.items) {
      expect(item.exam).toBe(run.questions.find((q) => q.position === item.position)!.exam);
    }
  });

  it("refuses an original sitting with no paper named", async () => {
    await twoPapers([1]);
    expect((await t.api("POST", "/topik/tests", { profile_id: adult, section: "listening", from: 1, to: 3 })).status).toBe(400);
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

    const run = (await t.api("POST", "/topik/tests", { profile_id: adult, section: "listening", exam: "Test-35회", from: 1, to: 3 })).body as {
      questions: { number: number; group_id: string }[];
    };
    const byNumber = new Map(run.questions.map((q) => [q.number, q.group_id]));
    expect(byNumber.get(2)).toBe(segment!.s);
    expect(byNumber.get(3)).toBe(segment!.s);
    // Question 1 has a clip of its own, so it is a group of one — a different id from the pair's.
    expect(byNumber.get(1)).not.toBe(segment!.s);
  });
});

// M7.11: the reading section gets its own mock test. Its draw has no clips to group by — each
// question stands alone — so a mixed reading paper is one question per position.
describe("reading mock test", () => {
  const readingQuestion = async (number: number, exam = "Read-60회") =>
    ((await t.api("POST", "/topik/questions", { ...input({ section: "reading", exam, number, block: `${number}` }), profile_id: adult })).body as { id: string }).id;

  const options = async (profile = adult) =>
    (await t.api("GET", `/topik/tests/options?profile_id=${profile}&section=reading`)).body as {
      papers: { exam: string; ready_questions: number; lengths: { length: number | string; available: boolean }[] }[];
      mixed: { ready_questions: number; reachable: number } | null;
    };

  it("lists a reading paper without needing any audio", async () => {
    for (const n of [1, 2, 3]) await readingQuestion(n);
    const body = await options();
    expect(body.papers).toHaveLength(1);
    expect(body.papers[0]).toMatchObject({ exam: "Read-60회", ready_questions: 3 });
    expect(body.papers[0]!.lengths.at(-1)).toMatchObject({ length: "full", available: true });
  });

  it("offers a mixed reading paper, one question per position", async () => {
    for (const n of [1, 2, 3]) await readingQuestion(n, "Read-60회");
    for (const n of [1, 2, 3]) await readingQuestion(n, "Read-64회");
    const body = await options();
    expect(body.mixed).toMatchObject({ ready_questions: 6, reachable: 3 });
  });

  it("creates a reading sitting with no audio and no clips", async () => {
    for (const n of [1, 2, 3]) await readingQuestion(n);
    const run = (await t.api("POST", "/topik/tests", { profile_id: adult, section: "reading", exam: "Read-60회", from: 1, to: 3 })).body as {
      section: string;
      audio: unknown;
      question_count: number;
      questions: { number: number; clip: unknown; group_id: string; stem: { text: string | null } }[];
    };
    expect(run).toMatchObject({ section: "reading", audio: null, question_count: 3 });
    expect(run.questions.every((q) => q.clip === null)).toBe(true);
    // Every reading question is its own group, so a screen holds exactly one of them.
    expect(new Set(run.questions.map((q) => q.group_id)).size).toBe(3);
    // Unlike listening, a reading stem is the question itself and is never withheld.
    expect(run.questions.every((q) => q.stem.text !== null)).toBe(true);
  });

  it("keeps a reading stem — text and image — through a reload of the sitting", async () => {
    // 26 reading questions on production have an image for a stem (a notice, a chart, a form), and
    // for some of them the image is the whole question: losing either half leaves nothing to read.
    const created = (await t.api("POST", "/topik/questions", {
      ...input({
        section: "reading",
        exam: "Read-60회",
        number: 1,
        block: "1",
        stem: { text: "다음 안내를 보고 물음에 답하십시오.", image_key: "topik/stem/notice.png" },
      }),
      profile_id: adult,
    })).body as { id: string };
    expect(created.id).toBeTruthy();

    const run = (await t.api("POST", "/topik/tests", { profile_id: adult, section: "reading", exam: "Read-60회", from: 1, to: 1 })).body as {
      id: string;
      questions: { stem: { text: string | null; image_key: string | null } }[];
    };
    expect(run.questions[0]!.stem).toEqual({ text: "다음 안내를 보고 물음에 답하십시오.", image_key: "topik/stem/notice.png" });

    const reopened = (await t.api("GET", `/topik/tests/${run.id}?profile_id=${adult}`)).body as {
      questions: { stem: { text: string | null; image_key: string | null } }[];
    };
    expect(reopened.questions[0]!.stem).toEqual({ text: "다음 안내를 보고 물음에 답하십시오.", image_key: "topik/stem/notice.png" });
  });

  it("draws a mixed reading paper from more than one exam", async () => {
    for (const n of [1, 2, 3]) await readingQuestion(n, "Read-60회");
    for (const n of [1, 2, 3]) await readingQuestion(n, "Read-64회");
    const first = (await t.api("POST", "/topik/tests", { profile_id: adult, section: "reading", kind: "mixed", from: 1, to: 3 })).body as {
      id: string;
      source_exam: string | null;
      questions: { number: number; exam: string }[];
    };
    expect(first.source_exam).toBeNull();
    expect(first.questions.map((q) => q.number)).toEqual([1, 2, 3]);
    await t.api("POST", `/topik/tests/${first.id}/finish`, { profile_id: adult });

    // Every position has one alternative, and the first sitting used all of them up.
    const second = (await t.api("POST", "/topik/tests", { profile_id: adult, section: "reading", kind: "mixed", from: 1, to: 3 })).body as {
      questions: { number: number; exam: string }[];
    };
    for (const q of second.questions) {
      expect(q.exam).not.toBe(first.questions.find((f) => f.number === q.number)!.exam);
    }
  });

  it("keeps a reading sitting out of the listening history", async () => {
    for (const n of [1, 2, 3]) await readingQuestion(n);
    const run = (await t.api("POST", "/topik/tests", { profile_id: adult, section: "reading", exam: "Read-60회", from: 1, to: 3 })).body as { id: string };
    await t.api("POST", `/topik/tests/${run.id}/finish`, { profile_id: adult });

    expect((await options()).papers[0]!.ready_questions).toBe(3);
    const listening = (await t.api("GET", `/topik/tests/options?profile_id=${adult}&section=listening`)).body as OptionsBody;
    expect(listening.papers.every((p) => p.history.length === 0)).toBe(true);
  });
});

// --- the clock (M7.13) --------------------------------------------------------------------------
//
// The clock is the server's, and these are the promises that make a sitting worth anything: time
// passes whether or not a browser is watching, a pause costs nothing, and a paper nobody came back
// to does not sit at `running` for ever.

const iso = (ms: number) => new Date(ms).toISOString();

/** A POST with a pretend clock. `t.api` sends no headers, so this goes the long way round. */
async function at(method: string, url: string, body: unknown, nowMs: number) {
  const res = await t.send(`/api${url}`, {
    method,
    headers: { "content-type": "application/json", "X-Dev-Now": iso(nowMs) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as unknown };
}

const getAt = async (url: string, nowMs: number) => {
  const res = await t.raw(`/api${url}`, { "X-Dev-Now": iso(nowMs) });
  return { status: res.status, body: (await res.json()) as unknown };
};

type Clock = {
  started_at: number;
  length_ms: number | null;
  ends_at: number | null;
  paused_at: number | null;
  paused_ms: number;
  pause_count: number;
  server_now: number;
};

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
/** Three clips of a minute each (see `question`), so a full paper runs three minutes. */
const PAPER_MS = 3 * 60_000;

async function threeQuestionPaper() {
  for (const n of [1, 2, 3]) await question(n);
  return start();
}

describe("the sitting's clock", () => {
  it("draws a paper with its length known but no clock running", async () => {
    const test = (await threeQuestionPaper()) as unknown as Clock & { id: string };
    // The length is settled at the draw, so the screen can say how long the paper is before the
    // learner commits to starting it; `ends_at` is what waits for the tap.
    expect(test.length_ms).toBe(PAPER_MS);
    expect(test.ends_at).toBeNull();
    expect(test.server_now).toBeGreaterThan(0);
  });

  it("starts the clock once, at the paper's own length", async () => {
    const test = await threeQuestionPaper();
    const first = (await at("POST", `/topik/tests/${test.id}/start`, { profile_id: adult }, T0)).body as Clock;
    expect(first.length_ms).toBe(PAPER_MS);
    expect(first.ends_at).toBe(T0 + PAPER_MS);

    // A second tap (or a replayed request) must not move the deadline.
    const again = (await at("POST", `/topik/tests/${test.id}/start`, { profile_id: adult }, T0 + 30_000)).body as Clock;
    expect(again.ends_at).toBe(T0 + PAPER_MS);
  });

  it("gives a reading paper the real exam's rate instead of a tape", async () => {
    for (const n of [1, 2]) {
      const id = ((await t.api("POST", "/topik/questions", {
        ...input({ number: n, section: "reading", exam: "Read-1", block: "1~2", stem: { text: "( )", image_key: null } }),
        profile_id: adult,
      })).body as { id: string }).id;
      await t.env.DB.prepare("UPDATE topik_questions SET verified = 1 WHERE id = ?").bind(id).run();
    }
    const test = (await t.api("POST", "/topik/tests", { profile_id: adult, section: "reading", exam: "Read-1", from: 1, to: 2 })).body as {
      id: string;
    };
    const clock = (await at("POST", `/topik/tests/${test.id}/start`, { profile_id: adult }, T0)).body as Clock;
    // Two questions at 70 minutes per 50, rounded down to the minute.
    expect(clock.length_ms).toBe(2 * 60_000);
  });

  it("stops the clock while paused and charges nothing for the pause", async () => {
    const test = await threeQuestionPaper();
    await at("POST", `/topik/tests/${test.id}/start`, { profile_id: adult }, T0);

    const paused = (await at("POST", `/topik/tests/${test.id}/clock`, { profile_id: adult, paused: true }, T0 + 30_000)).body as Clock;
    expect(paused.paused_at).toBe(T0 + 30_000);
    expect(paused.pause_count).toBe(1);

    const resumed = (await at("POST", `/topik/tests/${test.id}/clock`, { profile_id: adult, paused: false }, T0 + 90_000)).body as Clock;
    // A minute of pause, so the deadline moved out by exactly a minute.
    expect(resumed.ends_at).toBe(T0 + PAPER_MS + 60_000);
    expect(resumed.paused_ms).toBe(60_000);
    expect(resumed.paused_at).toBeNull();
  });

  it("refuses to pause a paper that has not been started", async () => {
    const test = await threeQuestionPaper();
    const res = await at("POST", `/topik/tests/${test.id}/clock`, { profile_id: adult, paused: true }, T0);
    expect(res.status).toBe(409);
  });

  it("submits and grades a paper whose time ran out while nobody was looking", async () => {
    const test = await threeQuestionPaper();
    await at("POST", `/topik/tests/${test.id}/start`, { profile_id: adult }, T0);
    // One answer given before the phone was locked; the other two never were.
    await t.api("PUT", `/topik/tests/${test.id}/items/1`, { profile_id: adult, selected_option: 2 });

    // Opened again long after the deadline.
    const result = (await getAt(`/topik/tests/${test.id}?profile_id=${adult}`, T0 + PAPER_MS + 2 * 60 * 60_000)).body as {
      status: string;
      auto_submitted: boolean;
      correct_count: number;
      duration_ms: number;
      finished_at: number;
      items: { is_correct: boolean }[];
    };
    expect(result.status).toBe("finished");
    expect(result.auto_submitted).toBe(true);
    expect(result.correct_count).toBe(1);
    expect(result.items.map((i) => i.is_correct)).toEqual([true, false, false]);
    // Closed at its own deadline, not whenever it happened to be noticed two hours later.
    expect(result.finished_at).toBe(T0 + PAPER_MS);
    expect(result.duration_ms).toBe(PAPER_MS);

    // Graded for real: the schedule moved, exactly as a submitted paper would move it.
    const attempts = await t.env.DB.prepare("SELECT count(*) AS n FROM topik_attempts WHERE profile_id = ?").bind(adult).first<{ n: number }>();
    expect(attempts!.n).toBe(3);
  });

  it("does not expire a paused paper, however long it stands", async () => {
    const test = await threeQuestionPaper();
    await at("POST", `/topik/tests/${test.id}/start`, { profile_id: adult }, T0);
    await at("POST", `/topik/tests/${test.id}/clock`, { profile_id: adult, paused: true }, T0 + 30_000);

    const body = (await getAt(`/topik/tests/${test.id}?profile_id=${adult}`, T0 + 10 * 60_000)).body as Clock & { status: string };
    expect(body.status).toBe("running");
    expect(body.paused_at).toBe(T0 + 30_000);
  });

  it("abandons a pause nobody ever lifted, rather than leaving the paper answerable for ever", async () => {
    const test = await threeQuestionPaper();
    await at("POST", `/topik/tests/${test.id}/start`, { profile_id: adult }, T0);
    await at("POST", `/topik/tests/${test.id}/clock`, { profile_id: adult, paused: true }, T0);

    const res = await getAt(`/topik/tests/${test.id}?profile_id=${adult}`, T0 + 25 * 60 * 60_000);
    expect(res.status).toBe(410);
    const row = await t.env.DB.prepare("SELECT status FROM topik_tests WHERE id = ?").bind(test.id).first<{ status: string }>();
    expect(row!.status).toBe("abandoned");
  });

  it("times the sitting itself, whatever the client would have claimed", async () => {
    const test = await threeQuestionPaper();
    await at("POST", `/topik/tests/${test.id}/start`, { profile_id: adult }, T0);
    const result = (await at("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult }, T0 + 100_000)).body as {
      duration_ms: number;
      auto_submitted: boolean;
      pause_count: number;
    };
    expect(result.duration_ms).toBe(100_000);
    expect(result.auto_submitted).toBe(false);
    expect(result.pause_count).toBe(0);
  });

  it("counts a pause that was never lifted before submitting", async () => {
    const test = await threeQuestionPaper();
    await at("POST", `/topik/tests/${test.id}/start`, { profile_id: adult }, T0);
    await at("POST", `/topik/tests/${test.id}/clock`, { profile_id: adult, paused: true }, T0 + 20_000);
    const result = (await at("POST", `/topik/tests/${test.id}/finish`, { profile_id: adult }, T0 + 80_000)).body as {
      paused_ms: number;
      pause_count: number;
    };
    expect(result.pause_count).toBe(1);
    expect(result.paused_ms).toBe(60_000);
  });
});

// --- ranges (M7.14) -----------------------------------------------------------------------------
//
// A sitting covers a range of question numbers. Three promises: a range that would cut a pair in
// half is widened, a range with a hole in it refuses the sitting instead of quietly shortening it,
// and the preview that says so creates nothing.

type RangePreview = {
  from: number;
  to: number;
  expanded: boolean;
  added: number[];
  question_count: number;
  missing_number: number | null;
  length_ms: number;
};

const preview = async (from: number, to: number, over: Record<string, string> = {}) => {
  const qs = new URLSearchParams({ profile_id: adult, section: "listening", exam: "Test-35회", from: String(from), to: String(to), ...over });
  const res = await t.api("GET", `/topik/tests/range?${qs}`);
  return { status: res.status, body: res.body as RangePreview };
};

/** A paper where 21 and 22 share one clip, as every real paper does from 21 on. */
async function pairedPaper() {
  for (const n of [19, 20, 21, 22, 23]) await question(n);
  const shared = await t.env.DB.prepare("SELECT segment_id FROM topik_questions WHERE exam = 'Test-35회' AND number = 21").first<{
    segment_id: string;
  }>();
  await t.env.DB.prepare("UPDATE topik_questions SET segment_id = ? WHERE exam = 'Test-35회' AND number = 22")
    .bind(shared!.segment_id)
    .run();
}

describe("sitting a range of questions", () => {
  it("sits exactly the asked range, not the first N questions", async () => {
    for (const n of [1, 2, 3, 4, 5]) await question(n);
    const run = (await t.api("POST", "/topik/tests", {
      profile_id: adult,
      section: "listening",
      exam: "Test-35회",
      from: 3,
      to: 5,
    })).body as { question_count: number; from_number: number; to_number: number; questions: { number: number }[] };

    expect(run.questions.map((q) => q.number)).toEqual([3, 4, 5]);
    expect(run).toMatchObject({ question_count: 3, from_number: 3, to_number: 5 });
  });

  it("widens a range that would cut a pair in half, and says which numbers it pulled in", async () => {
    await pairedPaper();
    const ahead = await preview(19, 21);
    expect(ahead.body).toMatchObject({ from: 19, to: 22, expanded: true, added: [22], question_count: 4, missing_number: null });

    const behind = await preview(22, 23);
    expect(behind.body).toMatchObject({ from: 21, to: 23, expanded: true, added: [21] });
  });

  it("creates the widened sitting, not the one that was typed", async () => {
    await pairedPaper();
    const run = (await t.api("POST", "/topik/tests", {
      profile_id: adult,
      section: "listening",
      exam: "Test-35회",
      from: 19,
      to: 21,
    })).body as { from_number: number; to_number: number; questions: { number: number }[] };
    expect(run).toMatchObject({ from_number: 19, to_number: 22 });
    expect(run.questions.map((q) => q.number)).toEqual([19, 20, 21, 22]);
  });

  it("leaves a range alone when it already holds whole groups", async () => {
    await pairedPaper();
    expect((await preview(21, 22)).body).toMatchObject({ from: 21, to: 22, expanded: false, added: [] });
  });

  // M7.21: reading has no clip to share, so a passage's pair says so with `group_key`. Same
  // `expandToGroups`, same promise — which is the whole point of there being one group rule.
  describe("a reading paper whose 19-20 share a passage", () => {
    /** Questions 1..20 of a reading paper, with 19 and 20 marked as one passage. */
    async function readingPaper() {
      for (let n = 1; n <= 20; n++) {
        await t.api("POST", "/topik/questions", {
          ...input({ section: "reading", exam: "Read-35회", number: n, block: n >= 19 ? "19~20" : String(n) }),
          profile_id: adult,
        });
      }
      // What the importer writes from the file's CHUNG ĐOẠN mark; the question API has no field
      // for it, because a hand-made question has no file to say what it shares.
      await t.env.DB.prepare("UPDATE topik_questions SET group_key = ? WHERE exam = 'Read-35회' AND number IN (19, 20)")
        .bind("reading|Read-35회|19")
        .run();
    }

    const readingPreview = async (from: number, to: number) => {
      const qs = new URLSearchParams({ profile_id: adult, section: "reading", exam: "Read-35회", from: String(from), to: String(to) });
      return (await t.api("GET", `/topik/tests/range?${qs}`)).body as RangePreview;
    };

    it("widens 1-19 to 1-20 instead of cutting the passage in half", async () => {
      await readingPaper();
      expect(await readingPreview(1, 19)).toMatchObject({ from: 1, to: 20, expanded: true, added: [20], question_count: 20, missing_number: null });
    });

    it("widens 20-20 backwards to 19-20", async () => {
      await readingPaper();
      expect(await readingPreview(20, 20)).toMatchObject({ from: 19, to: 20, expanded: true, added: [19] });
    });

    it("leaves 1-18 alone — nothing there shares anything", async () => {
      await readingPaper();
      expect(await readingPreview(1, 18)).toMatchObject({ from: 1, to: 18, expanded: false, added: [] });
    });

    it("creates the widened sitting, both questions of the passage in it", async () => {
      await readingPaper();
      const run = (await t.api("POST", "/topik/tests", {
        profile_id: adult,
        section: "reading",
        exam: "Read-35회",
        from: 1,
        to: 19,
      })).body as { from_number: number; to_number: number; questions: { number: number; group_id: string }[] };
      expect(run).toMatchObject({ from_number: 1, to_number: 20 });
      expect(run.questions.map((q) => q.number)).toEqual([...Array(20)].map((_, i) => i + 1));
      // And on the sitting screen they are one group, so they are drawn on one page with the
      // passage above them exactly once.
      const pair = run.questions.filter((q) => q.number >= 19);
      expect(pair[0]!.group_id).toBe(pair[1]!.group_id);
      expect(run.questions.filter((q) => q.number === 18)[0]!.group_id).not.toBe(pair[0]!.group_id);
    });
  });

  it("names the missing question and refuses the sitting", async () => {
    for (const n of [1, 2, 4]) await question(n);
    expect((await preview(1, 4)).body).toMatchObject({ missing_number: 3, length_ms: 0 });

    const res = await t.api("POST", "/topik/tests", { profile_id: adult, section: "listening", exam: "Test-35회", from: 1, to: 4 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "topik_test_missing_number", missing_number: 3 });
  });

  it("reports the clips' real length for listening, and the reading rate for reading", async () => {
    for (const n of [1, 2, 3]) await question(n);
    // `question` lays each clip out as a minute, so questions 2-3 run two minutes.
    expect((await preview(2, 3)).body.length_ms).toBe(2 * 60_000);

    for (const n of [1, 2, 3]) {
      const id = ((await t.api("POST", "/topik/questions", {
        ...input({ number: n, section: "reading", exam: "Read-range", block: "1~3", stem: { text: "( )", image_key: null } }),
        profile_id: adult,
      })).body as { id: string }).id;
      await t.env.DB.prepare("UPDATE topik_questions SET verified = 1 WHERE id = ?").bind(id).run();
    }
    const reading = await preview(1, 3, { section: "reading", exam: "Read-range" });
    // Three questions at 70 minutes per 50, rounded down to the minute.
    expect(reading.body.length_ms).toBe(4 * 60_000);
  });

  it("previews without creating anything", async () => {
    for (const n of [1, 2]) await question(n);
    const before = await t.env.DB.prepare("SELECT count(*) AS n FROM topik_tests").first<{ n: number }>();
    for (const [from, to] of [[1, 1], [1, 2], [2, 2], [1, 9]]) await preview(from!, to!);
    const after = await t.env.DB.prepare("SELECT count(*) AS n FROM topik_tests").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
    expect(after!.n).toBe(0);
  });

  it("refuses a backwards or oversized range before it reaches the bank", async () => {
    await question(1);
    const backwards = await t.api("POST", "/topik/tests", { profile_id: adult, section: "listening", exam: "Test-35회", from: 5, to: 2 });
    expect(backwards.status).toBe(400);
    const huge = await t.api("POST", "/topik/tests", { profile_id: adult, section: "listening", exam: "Test-35회", from: 1, to: 80 });
    expect(huge.status).toBe(400);
  });

  it("tells two sittings of different ranges apart in the history", async () => {
    for (const n of [1, 2, 3, 4]) await question(n);
    for (const [from, to] of [[1, 2], [3, 4]]) {
      const run = (await t.api("POST", "/topik/tests", {
        profile_id: adult,
        section: "listening",
        exam: "Test-35회",
        from,
        to,
      })).body as { id: string };
      await t.api("POST", `/topik/tests/${run.id}/finish`, { profile_id: adult });
    }
    const history = (await options()).papers[0]!.history as unknown as { from_number: number; to_number: number }[];
    expect(history.map((h) => [h.from_number, h.to_number]).sort()).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("draws a mixed range from anywhere in the bank", async () => {
    for (const n of [16, 17, 18]) await question(n, { exam: "Test-35회" });
    for (const n of [16, 17, 18]) await question(n, { exam: "Test-41회" });
    const run = (await t.api("POST", "/topik/tests", {
      profile_id: adult,
      section: "listening",
      kind: "mixed",
      from: 16,
      to: 18,
    })).body as { from_number: number; to_number: number; questions: { number: number; exam: string }[] };
    expect(run).toMatchObject({ from_number: 16, to_number: 18 });
    expect(run.questions.map((q) => q.number)).toEqual([16, 17, 18]);
  });
});
