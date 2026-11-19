import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PODCAST_GAP_MS, podcastSpeech, type PodcastPlaylist } from "../../shared/podcast";
import type { TopikQuestionInput } from "../../shared/topik";
import { createTestEnv } from "../test/testEnv";
import { audioKey } from "../services/tts";
import { PODCAST_MANIFEST_KEY } from "../../shared/podcast";

/**
 * The podcast playlist (SPEC F13, M8.1).
 *
 * What these prove is mostly what the playlist **refuses** to contain: a question whose options
 * are pictures, a question whose TTS has never been generated, and — across every paper — a
 * question this profile has never answered, which belongs to a mock test (M7.27). Every one of
 * them is counted and reported, because quietly returning fewer questions than were asked for is
 * the failure this project keeps finding.
 */

let t: Awaited<ReturnType<typeof createTestEnv>>;
let adult: string;
const VOICE = "ko-KR-SunHiNeural";

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());

const profile = (over: Record<string, unknown> = {}) => ({
  name: "Bố", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 10, study_langs: ["ko"], ...over,
});

const question = (number: number, over: Partial<TopikQuestionInput> = {}): TopikQuestionInput => ({
  section: "listening",
  exam: "Listen-60회",
  number,
  block: `${number}`,
  instruction: "[4~8] 다음 대화를 잘 듣고 이어질 수 있는 말을 고르십시오. (각 2점)",
  points: 2,
  stem: { text: "남자: 어디에 가요?", image_key: null },
  options: [
    { text: "학교에 가요.", image_key: null },
    { text: "집에 있어요.", image_key: null },
    { text: "밥을 먹어요.", image_key: null },
    { text: "친구를 만나요.", image_key: null },
  ],
  correct_option: 2,
  ...over,
});

/** A verified listening question with a clip of its own, which is the only kind a podcast uses. */
async function addQuestion(number: number, over: Partial<TopikQuestionInput> = {}) {
  const exam = over.exam ?? "Listen-60회";
  const created = (await t.api("POST", "/topik/questions", { ...question(number, over), exam, profile_id: adult })).body as { id: string };
  const now = Date.now();
  let audioId = (await t.env.DB.prepare("SELECT id FROM topik_audio WHERE exam = ?").bind(exam).first<{ id: string }>())?.id;
  if (!audioId) {
    audioId = crypto.randomUUID();
    await t.env.DB.prepare(
      `INSERT INTO topik_audio (id, section, exam, audio_key, duration_ms, verified, created_at, updated_at)
       VALUES (?, 'listening', ?, ?, 600000, 1, ?, ?)`,
    )
      .bind(audioId, exam, `topik/audio/${"a".repeat(40)}.mp3`, now, now)
      .run();
  }
  const segmentId = crypto.randomUUID();
  await t.env.DB.prepare(
    "INSERT INTO topik_segments (id, audio_id, idx, start_ms, speech_end_ms, end_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(segmentId, audioId, number, number * 30_000, number * 30_000 + 20_000, number * 30_000 + 26_000, now)
    .run();
  await t.env.DB.prepare("UPDATE topik_questions SET segment_id = ?, verified = 1 WHERE id = ?").bind(segmentId, created.id).run();
  return created.id;
}

/** Writes the manifest the script normally writes: these questions' TTS has been generated. */
async function generateTts(numbers: readonly number[], over: Partial<TopikQuestionInput> = {}) {
  const keys: string[] = [];
  for (const number of numbers) {
    const speech = podcastSpeech({ ...question(number, over), instruction: question(number, over).instruction })!;
    for (const text of [speech.number, speech.questionLine, speech.options, speech.answer]) {
      keys.push(await audioKey("ko", VOICE, text));
    }
  }
  await t.env.MEDIA.put(
    PODCAST_MANIFEST_KEY,
    JSON.stringify({ version: 1, generated_at: new Date().toISOString(), keys: [...new Set(keys)] }),
  );
}

const podcast = async (query: string) => (await t.api("GET", `/topik/podcast?profile_id=${adult}&${query}`)).body as PodcastPlaylist;

beforeEach(async () => {
  for (const table of ["topik_test_items", "topik_tests", "topik_attempts", "topik_cards", "topik_segments", "topik_audio", "topik_questions", "profiles"]) {
    await t.env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await t.env.MEDIA.delete(PODCAST_MANIFEST_KEY);
  adult = ((await t.api("POST", "/profiles", profile())).body as { id: string }).id;
});

describe("podcast playlist", () => {
  it("plays one question in F13's order: number, question line, clip, options, gap, answer", async () => {
    await addQuestion(4);
    await generateTts([4]);

    const body = await podcast("exam=Listen-60%ED%9A%8C&from=4&to=4");
    expect(body.questions).toHaveLength(1);
    const [q] = body.questions;
    expect(q!.number).toBe(4);
    expect(q!.tracks.map((tr) => tr.kind)).toEqual(["file", "file", "clip", "file", "silence", "file"]);

    // The clip is the exam's own recording, at the exam's own timestamps — never TTS (F13).
    const clip = q!.tracks[2]!;
    expect(clip).toMatchObject({ kind: "clip", audio_key: `topik/audio/${"a".repeat(40)}.mp3`, start_ms: 120_000, end_ms: 146_000 });
    expect(q!.tracks[4]).toEqual({ kind: "silence", ms: PODCAST_GAP_MS });
    expect(body.gap_ms).toBe(PODCAST_GAP_MS);
    expect(body.skipped).toEqual({ picture_options: 0, no_clip: 0, reserved_for_tests: 0, no_tts: 0 });
  });

  it("leaves out questions 1-3 and says how many, instead of quietly returning fewer", async () => {
    for (const n of [1, 2, 3, 4]) await addQuestion(n);
    await generateTts([4]);

    const body = await podcast("exam=Listen-60%ED%9A%8C&from=1&to=4");
    expect(body.questions.map((q) => q.number)).toEqual([4]);
    expect(body.skipped.picture_options).toBe(3);
  });

  it("leaves out a question whose TTS has not been generated, and counts it", async () => {
    await addQuestion(4);
    await addQuestion(5);
    await generateTts([4]);

    const body = await podcast("exam=Listen-60%ED%9A%8C&from=4&to=5");
    expect(body.questions.map((q) => q.number)).toEqual([4]);
    expect(body.skipped.no_tts).toBe(1);
  });

  it("with no manifest at all, every question is reported as having no TTS yet", async () => {
    await addQuestion(4);
    const body = await podcast("exam=Listen-60%ED%9A%8C&from=4&to=4");
    expect(body.questions).toHaveLength(0);
    expect(body.skipped.no_tts).toBe(1);
  });

  /**
   * M7.27, which matters more here than anywhere else: the podcast reads the answer out loud, so
   * a question nobody has answered yet would be spent before it was ever sat.
   */
  it("across every paper, keeps unanswered questions for a mock test and says how many", async () => {
    const answered = await addQuestion(4);
    await addQuestion(5);
    await generateTts([4]);
    await generateTts([4, 5]);
    await t.api("POST", "/topik/attempts", { profile_id: adult, question_id: answered, selected_option: 2 });

    const all = await podcast("from=4&to=5");
    expect(all.questions.map((q) => q.number)).toEqual([4]);
    expect(all.skipped.reserved_for_tests).toBe(1);

    // One paper chosen by name is the deliberate way to hear new questions, unchanged.
    const paper = await podcast("exam=Listen-60%ED%9A%8C&from=4&to=5");
    expect(paper.questions.map((q) => q.number)).toEqual([4, 5]);
    expect(paper.skipped.reserved_for_tests).toBe(0);
  });

  it("widens the range to whole groups, like practice does", async () => {
    await addQuestion(4);
    await addQuestion(5);
    await generateTts([4, 5]);
    const body = await podcast("exam=Listen-60%ED%9A%8C&from=4&to=5");
    expect(body).toMatchObject({ from: 4, to: 5, expanded: false });
  });

  it("lists the papers a podcast can be built from", async () => {
    await addQuestion(4);
    await addQuestion(7, { exam: "Listen-64회" });
    const body = (await t.api("GET", `/topik/podcast/papers?profile_id=${adult}`)).body as {
      papers: { exam: string; questions: number; max_number: number }[];
      max_number: number;
    };
    expect(body.papers).toEqual([
      { exam: "Listen-60회", questions: 1, max_number: 4 },
      { exam: "Listen-64회", questions: 1, max_number: 7 },
    ]);
    expect(body.max_number).toBe(7);
  });
});
