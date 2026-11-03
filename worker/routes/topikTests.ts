// Mock tests (M6.4, SPEC F12): sit a real paper end to end, under the paper's own pacing.
//
// Stage 1 is one original paper. The routes are already shaped for stage 2's mixed paper, which
// draws each position from a different exam: a test owns a *list of questions*
// (`topik_test_items`), never an exam, so mixing needs no migration — only a different way of
// choosing the rows that go into that list.
//
// Two rules decide most of the code here:
//  - while a test is running, nothing in any response may give the answer away: no
//    `correct_option`, and for listening no transcript (the stem text *is* the transcript);
//  - abandoning a test must leave no trace in the FSRS schedule. Only `finish` writes attempts and
//    moves cards, and it writes them with `scheduled = 1`: a timed sitting is the truest recall
//    test there is, so it is the best possible input for the spacing.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { topikSectionSchema } from "../../shared/enums";
import { applyReview, emptyCardFields } from "../../shared/scheduling";
import {
  topikTestCreateSchema,
  topikTestAnswerSchema,
  topikTestFinishSchema,
  type TopikTestLength,
} from "../../shared/topik";
import { topik_attempts, topik_audio, topik_cards, topik_questions, topik_segments, topik_test_items, topik_tests } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { DEV_NOW_HEADER, resolveNow } from "../lib/devNow";
import { requireAdult } from "../lib/access";
import { zv } from "../lib/validate";
import { readInD1Chunks, writeInD1Chunks } from "../lib/d1Chunk";
import { audioSpan, isContiguousFromOne, lengthOptions, lengthQuestionCount, pointsOf, scoreTest } from "../services/topikTest";
import { mixedLengthOptions, planMixedTest, reachableLength, type MixedCandidate } from "../services/topikMixed";
import { toCardFields } from "../services/topikCards";

const err = (error: string) => ({ error });
/** Columns `topik_test_items` binds per row: id, test_id, position, question_id, number, points, segment_id. */
const ITEM_INSERT_PARAMS = 7;
const idParam = zv("param", z.object({ id: z.string().min(1) }));
/** How far back "already seen" looks when drawing a mixed paper. */
const SEEN_SITTINGS = 3;

/** A question is usable in a test only when it is approved and, for listening, has an approved clip. */
const readyQuestions = (section: "reading" | "listening") =>
  section === "listening"
    ? sql`${topik_questions.verified} = 1 AND ${topik_questions.segment_id} IS NOT NULL AND EXISTS (
          SELECT 1 FROM topik_audio a WHERE a.section = ${topik_questions.section} AND a.exam = ${topik_questions.exam} AND a.verified = 1)`
    : sql`${topik_questions.verified} = 1`;

export const topikTestRoutes = () =>
  new Hono<AppEnv>()
    // --- Picking a paper -----------------------------------------------------------------------
    .get("/topik/tests/options", zv("query", z.object({ profile_id: z.string().min(1), section: topikSectionSchema })), async (c) => {
      const { profile_id, section } = c.req.valid("query");
      const db = getDb(c.env);

      const rows = await db
        .select({ exam: topik_questions.exam, number: topik_questions.number })
        .from(topik_questions)
        .where(and(eq(topik_questions.section, section), readyQuestions(section)))
        .orderBy(asc(topik_questions.exam), asc(topik_questions.number));

      const byExam = new Map<string, number[]>();
      for (const r of rows) byExam.set(r.exam, [...(byExam.get(r.exam) ?? []), r.number]);

      const history = await db
        .select()
        .from(topik_tests)
        .where(and(eq(topik_tests.profile_id, profile_id), eq(topik_tests.section, section), eq(topik_tests.status, "finished")))
        .orderBy(desc(topik_tests.finished_at));

      const entry = (h: TestRow) => ({
        id: h.id,
        score_points: h.score_points ?? 0,
        total_points: h.total_points,
        question_count: h.question_count,
        correct_count: h.correct_count ?? 0,
        finished_at: (h.finished_at ?? h.started_at).getTime(),
      });

      const papers = [...byExam.entries()].map(([exam, numbers]) => {
        const contiguous = isContiguousFromOne(numbers);
        return {
          exam,
          ready_questions: numbers.length,
          contiguous,
          lengths: lengthOptions(numbers.length, contiguous),
          // An original paper's history is that paper's own sittings, never a mixed one's.
          history: history.filter((h) => h.kind === "original" && h.source_exam === exam).map(entry),
        };
      });

      // The mixed card draws clips, so a section with no clips (reading) has no mixed mode at all.
      const candidates = section === "listening" ? await mixedCandidates(db) : [];
      const mixed =
        candidates.length === 0
          ? null
          : {
              ready_questions: candidates.reduce((n, c) => n + c.numbers.length, 0),
              reachable: reachableLength(candidates),
              lengths: mixedLengthOptions(candidates),
              history: history.filter((h) => h.kind === "mixed").map(entry),
            };

      return c.json({ papers, mixed });
    })

    /**
     * Clips for the mixed-tape spike (M6.5): a handful of real clips taken from *different* exams,
     * in question order, so the two-element playback can be tried on a real phone before the rest
     * of the mixed mode exists. Read-only, writes nothing, creates no sitting. It will go once the
     * real draw endpoint lands — the point of it is to answer one question early: can a phone play
     * the second `<audio>` element at all.
     */
    .get("/topik/tests/probe-clips", zv("query", z.object({ profile_id: z.string().min(1), count: z.coerce.number().int().min(2).max(8).default(4) })), async (c) => {
      const { profile_id, count } = c.req.valid("query");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);

      const rows = await db
        .select({
          exam: topik_questions.exam,
          number: topik_questions.number,
          segment_id: topik_questions.segment_id,
        })
        .from(topik_questions)
        .where(and(eq(topik_questions.section, "listening"), readyQuestions("listening")))
        .orderBy(asc(topik_questions.number), asc(topik_questions.exam));

      // Alternate exams on purpose: a run that happens to stay in one file would prove nothing.
      const exams = [...new Set(rows.map((r) => r.exam))].sort();
      const picked = rows.filter((r, _i, all) => {
        const sameNumber = all.filter((x) => x.number === r.number);
        const wanted = exams[(r.number - 1) % exams.length];
        return sameNumber.length > 0 && r.exam === wanted;
      });

      const chosen = picked.slice(0, count);
      const clips = await clipsFor(db, chosen.map((r) => r.segment_id).filter((s): s is string => s !== null));
      return c.json({
        clips: chosen
          .map((r) => {
            const clip = r.segment_id ? clips.get(r.segment_id) : undefined;
            return clip ? { exam: r.exam, number: r.number, ...clip } : null;
          })
          .filter((c): c is NonNullable<typeof c> => c !== null),
      });
    })

    // --- Sitting one ---------------------------------------------------------------------------
    .post("/topik/tests", zv("json", topikTestCreateSchema), async (c) => {
      const { profile_id, section, kind, exam, length } = c.req.valid("json");
      const db = getDb(c.env);

      // Two ways to choose the questions, one way to sit them: a test owns a list of questions, so
      // the mixed mode differs only in how that list is filled.
      const picked = kind === "mixed" ? await drawMixed(db, profile_id, section, length) : await takePaper(db, section, exam!, length);
      if ("error" in picked) return c.json(picked.error, 400);
      const chosen = picked.questions;

      const clips = await clipsFor(db, chosen.map((q) => q.segment_id).filter((s): s is string => s !== null));
      const total_points = chosen.reduce((n, q) => n + pointsOf(q.points), 0);

      const [test] = await db
        .insert(topik_tests)
        .values({
          profile_id,
          section,
          kind,
          // A mixed sitting has no source paper; each item carries its own, read live from the
          // question it points at.
          source_exam: kind === "mixed" ? null : exam!,
          question_count: chosen.length,
          total_points,
          status: "running",
          started_at: resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url),
        })
        .returning();

      // Seven bound parameters per row: a 20-question paper is 140, over D1's ceiling of 100, so
      // this goes in chunks (`writeInD1Chunks`). A failure here would otherwise leave the test row
      // behind with no questions in it — a sitting that exists and cannot be taken — so the row is
      // removed before the error is reported.
      try {
        await writeInD1Chunks(
          chosen.map((q) => ({
            test_id: test!.id,
            position: q.number,
            question_id: q.id,
            number: q.number,
            points: pointsOf(q.points),
            segment_id: q.segment_id,
          })),
          ITEM_INSERT_PARAMS,
          (rows) => db.insert(topik_test_items).values(rows),
        );
      } catch (e) {
        await db.delete(topik_tests).where(eq(topik_tests.id, test!.id));
        throw e;
      }

      return c.json(runPayload(test!, chosen, clips, new Map()), 201);
    })

    .get("/topik/tests/:id", idParam, zv("query", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const db = getDb(c.env);
      const test = await db.select().from(topik_tests).where(eq(topik_tests.id, c.req.valid("param").id)).get();
      if (!test || test.profile_id !== c.req.valid("query").profile_id) return c.json(err("not_found"), 404);

      const items = await db.select().from(topik_test_items).where(eq(topik_test_items.test_id, test.id)).orderBy(asc(topik_test_items.position));
      const questions = await questionsOf(db, items.map((i) => i.question_id));
      const clips = await clipsFor(db, items.map((i) => i.segment_id).filter((s): s is string => s !== null));

      // An abandoned sitting has no result, and must not become a way to read the answer key:
      // start a test, cancel it, and the paper would otherwise hand over every correct option.
      if (test.status === "abandoned") return c.json(err("topik_test_abandoned"), 410);

      // Running: the answers stay hidden, exactly as in a practice session.
      if (test.status === "running") {
        const chosen = items.map((i) => questions.get(i.question_id ?? "")).filter((q): q is NonNullable<typeof q> => !!q);
        return c.json(runPayload(test, chosen, clips, new Map(items.map((i) => [i.position, i.selected_option]))));
      }
      return c.json(resultPayload(test, items, questions, clips));
    })

    /**
     * One answer, saved as it is given. The phone may be on a bad connection, so the client keeps
     * its own copy and replays whatever failed at `finish` — this endpoint only has to be safe to
     * call again with a different answer for the same position, which it is.
     */
    .put(
      "/topik/tests/:id/items/:position",
      zv("param", z.object({ id: z.string().min(1), position: z.coerce.number().int().positive() })),
      zv("json", topikTestAnswerSchema),
      async (c) => {
        const { id, position } = c.req.valid("param");
        const { profile_id, selected_option } = c.req.valid("json");
        const db = getDb(c.env);
        const test = await db.select().from(topik_tests).where(eq(topik_tests.id, id)).get();
        if (!test || test.profile_id !== profile_id) return c.json(err("not_found"), 404);
        if (test.status !== "running") return c.json(err("topik_test_not_running"), 409);

        const updated = await db
          .update(topik_test_items)
          .set({ selected_option, answered_at: resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url) })
          .where(and(eq(topik_test_items.test_id, id), eq(topik_test_items.position, position)))
          .returning({ position: topik_test_items.position });
        if (updated.length === 0) return c.json(err("not_found"), 404);
        return c.json({ position, selected_option });
      },
    )

    .post("/topik/tests/:id/finish", idParam, zv("json", topikTestFinishSchema), async (c) => {
      const { profile_id, duration_ms, pause_count, paused_ms, answers } = c.req.valid("json");
      const db = getDb(c.env);
      const now = resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url);
      const test = await db.select().from(topik_tests).where(eq(topik_tests.id, c.req.valid("param").id)).get();
      if (!test || test.profile_id !== profile_id) return c.json(err("not_found"), 404);
      if (test.status !== "running") return c.json(err("topik_test_not_running"), 409);

      // Answers the tape ran past while the network was down: applied before anything is graded,
      // so a dropped request never costs a mark.
      for (const a of answers ?? []) {
        await db
          .update(topik_test_items)
          .set({ selected_option: a.selected_option, answered_at: now })
          .where(and(eq(topik_test_items.test_id, test.id), eq(topik_test_items.position, a.position)));
      }

      const items = await db.select().from(topik_test_items).where(eq(topik_test_items.test_id, test.id)).orderBy(asc(topik_test_items.position));
      const questions = await questionsOf(db, items.map((i) => i.question_id));

      const graded = items.map((i) => {
        const q = questions.get(i.question_id ?? "");
        return { ...i, is_correct: !!q && i.selected_option === q.correct_option };
      });
      for (const g of graded) {
        await db.update(topik_test_items).set({ is_correct: g.is_correct }).where(eq(topik_test_items.id, g.id));
      }

      // A timed sitting is a real recall test, so it feeds the schedule like any review would.
      for (const g of graded) {
        const q = questions.get(g.question_id ?? "");
        if (!q) continue;
        const existing = await db
          .select()
          .from(topik_cards)
          .where(and(eq(topik_cards.profile_id, profile_id), eq(topik_cards.question_id, q.id)))
          .get();
        const { card } = applyReview(existing ? toCardFields(existing) : emptyCardFields(now), g.is_correct ? 3 : 1, now);
        if (existing) await db.update(topik_cards).set({ ...card, updated_at: now }).where(eq(topik_cards.id, existing.id));
        else await db.insert(topik_cards).values({ profile_id, question_id: q.id, ...card });

        await db.insert(topik_attempts).values({
          profile_id,
          question_id: q.id,
          section: q.section,
          exam: q.exam,
          number: q.number,
          selected_option: g.selected_option ?? 0,
          is_correct: g.is_correct,
          scheduled: true,
          duration_ms: null,
        });
      }

      const score = scoreTest(graded.map((g) => ({ points: g.points, is_correct: g.is_correct })));
      const [finished] = await db
        .update(topik_tests)
        .set({
          status: "finished",
          finished_at: now,
          duration_ms,
          pause_count,
          paused_ms,
          correct_count: score.correct_count,
          score_points: score.score_points,
        })
        .where(eq(topik_tests.id, test.id))
        .returning();

      const clips = await clipsFor(db, items.map((i) => i.segment_id).filter((s): s is string => s !== null));
      return c.json(resultPayload(finished!, graded, questions, clips));
    })

    /** Left before the end: no score, no attempts, nothing touched in the schedule. */
    .post("/topik/tests/:id/abandon", idParam, zv("json", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const db = getDb(c.env);
      const test = await db.select().from(topik_tests).where(eq(topik_tests.id, c.req.valid("param").id)).get();
      if (!test || test.profile_id !== c.req.valid("json").profile_id) return c.json(err("not_found"), 404);
      if (test.status === "finished") return c.json(err("topik_test_not_running"), 409);
      await db.update(topik_tests).set({ status: "abandoned" }).where(eq(topik_tests.id, test.id));
      return c.json({ id: test.id, status: "abandoned" });
    });

// --- helpers ------------------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;
type QuestionRow = typeof topik_questions.$inferSelect;
type TestRow = typeof topik_tests.$inferSelect;
type ItemRow = typeof topik_test_items.$inferSelect;
type Clip = { audio_key: string; start_ms: number; speech_end_ms: number; end_ms: number };

type Picked = { questions: QuestionRow[] } | { error: { error: string; missing_position?: number } };

/** One original paper, questions 1..N. */
async function takePaper(db: Db, section: "reading" | "listening", exam: string, length: TopikTestLength): Promise<Picked> {
  const all = await db
    .select()
    .from(topik_questions)
    .where(and(eq(topik_questions.section, section), eq(topik_questions.exam, exam), readyQuestions(section)))
    .orderBy(asc(topik_questions.number));

  if (!isContiguousFromOne(all.map((q) => q.number))) return { error: err("topik_test_not_contiguous") };
  const wanted = lengthQuestionCount(length, all.length);
  if (wanted <= 0 || wanted > all.length) return { error: err("topik_test_too_short") };
  return { questions: all.slice(0, wanted) };
}

/**
 * A mixed paper: every position drawn from the whole bank, preferring questions this profile has
 * not met lately (`planMixedTest` has the rules). The failure carries the position the bank ran
 * out at — "the bank has nothing for question 23" is actionable; "too short" is not.
 */
async function drawMixed(db: Db, profileId: string, section: "reading" | "listening", length: TopikTestLength): Promise<Picked> {
  const candidates = await mixedCandidates(db);
  const wanted = lengthQuestionCount(length, reachableLength(candidates));
  if (wanted <= 0) return { error: { ...err("topik_test_bank_short"), missing_position: 1 } };

  const plan = planMixedTest({ candidates, length: wanted, seen: await seenRanks(db, profileId, section), random: Math.random });
  if (!plan.ok) return { error: { ...err("topik_test_bank_short"), missing_position: plan.missingPosition } };

  const rows = await questionsOf(db, plan.picks.map((p) => p.question_id));
  const questions = plan.picks.map((p) => rows.get(p.question_id)).filter((q): q is QuestionRow => !!q);
  if (questions.length !== plan.picks.length) return { error: { ...err("topik_test_bank_short"), missing_position: 1 } };
  return { questions: questions.sort((a, b) => a.number - b.number) };
}

/** Every approved listening clip in the bank, with the questions asked about it. */
async function mixedCandidates(db: Db): Promise<MixedCandidate[]> {
  const rows = await db
    .select({ id: topik_questions.id, exam: topik_questions.exam, number: topik_questions.number, segment_id: topik_questions.segment_id })
    .from(topik_questions)
    .where(and(eq(topik_questions.section, "listening"), readyQuestions("listening")))
    .orderBy(asc(topik_questions.number));

  const byClip = new Map<string, MixedCandidate>();
  for (const r of rows) {
    if (!r.segment_id) continue;
    const found = byClip.get(r.segment_id) ?? { segment_id: r.segment_id, exam: r.exam, numbers: [], question_ids: [] };
    found.numbers.push(r.number);
    found.question_ids.push(r.id);
    byClip.set(r.segment_id, found);
  }
  return [...byClip.values()];
}

/**
 * How recently this profile met each question: 1 = the most recent sitting, and so on over the last
 * few. An **abandoned** sitting counts only the questions actually answered — the tape may have
 * stopped at question 3, and pretending the other 17 were seen would push them out of the next
 * draw for nothing. A finished sitting counts all of its questions, answered or not: the tape
 * played every one of them.
 */
async function seenRanks(db: Db, profileId: string, section: "reading" | "listening"): Promise<Map<string, number>> {
  const recent = await db
    .select({ id: topik_tests.id, status: topik_tests.status })
    .from(topik_tests)
    .where(and(eq(topik_tests.profile_id, profileId), eq(topik_tests.section, section)))
    .orderBy(desc(topik_tests.started_at))
    .limit(SEEN_SITTINGS);
  if (recent.length === 0) return new Map();

  const items = await readInD1Chunks(recent.map((r) => r.id), (chunk) =>
    db
      .select({ test_id: topik_test_items.test_id, question_id: topik_test_items.question_id, answered_at: topik_test_items.answered_at })
      .from(topik_test_items)
      .where(inArray(topik_test_items.test_id, chunk)),
  );

  const ranks = new Map<string, number>();
  for (const item of items) {
    const sitting = recent.findIndex((r) => r.id === item.test_id);
    if (sitting < 0 || !item.question_id) continue;
    if (recent[sitting]!.status !== "finished" && item.answered_at === null) continue;
    const rank = sitting + 1;
    const known = ranks.get(item.question_id);
    if (known === undefined || rank < known) ranks.set(item.question_id, rank);
  }
  return ranks;
}

async function questionsOf(db: Db, ids: readonly (string | null)[]): Promise<Map<string, QuestionRow>> {
  const wanted = ids.filter((i): i is string => i !== null);
  if (wanted.length === 0) return new Map();
  const rows = await readInD1Chunks(wanted, (chunk) => db.select().from(topik_questions).where(inArray(topik_questions.id, chunk)));
  return new Map(rows.map((r) => [r.id, r]));
}

/** segment id → clip, with the key of the file it belongs to. */
async function clipsFor(db: Db, segmentIds: readonly string[]): Promise<Map<string, Clip>> {
  if (segmentIds.length === 0) return new Map();
  const rows = await readInD1Chunks([...segmentIds], (chunk) =>
    db
      .select({
        id: topik_segments.id,
        start_ms: topik_segments.start_ms,
        speech_end_ms: topik_segments.speech_end_ms,
        end_ms: topik_segments.end_ms,
        audio_key: topik_audio.audio_key,
      })
      .from(topik_segments)
      .innerJoin(topik_audio, eq(topik_audio.id, topik_segments.audio_id))
      .where(inArray(topik_segments.id, chunk)),
  );
  return new Map(rows.map((r) => [r.id, { audio_key: r.audio_key, start_ms: r.start_ms, speech_end_ms: r.speech_end_ms, end_ms: r.end_ms }]));
}

/** The running payload: never `correct_option`, and never a listening question's stem (its text is
 * the transcript, which is the answer read out loud). */
function runPayload(test: TestRow, questions: readonly QuestionRow[], clips: Map<string, Clip>, answered: Map<number, number | null>) {
  const used = questions.map((q) => (q.segment_id ? clips.get(q.segment_id) : undefined)).filter((c): c is Clip => !!c);
  // Only an original paper has one span of one file. A mixed paper's clips come from several mp3s,
  // so there is nothing to span: the client stitches the per-question clips into a tape instead.
  const span = test.kind === "original" ? audioSpan(used) : null;
  return {
    id: test.id,
    section: test.section,
    kind: test.kind,
    source_exam: test.source_exam,
    status: test.status,
    question_count: test.question_count,
    total_points: test.total_points,
    started_at: test.started_at.getTime(),
    audio: span && used[0] ? { audio_key: used[0].audio_key, ...span } : null,
    questions: questions.map((q) => {
      const clip = q.segment_id ? (clips.get(q.segment_id) ?? null) : null;
      return {
        position: q.number,
        question_id: q.id,
        number: q.number,
        points: pointsOf(q.points),
        instruction: q.instruction,
        exam: q.exam,
        stem: { text: test.section === "listening" ? null : q.stem_text, image_key: q.stem_image_key },
        options: q.options,
        selected_option: answered.get(q.number) ?? null,
        clip: clip ? { audio_key: clip.audio_key, start_ms: clip.start_ms, speech_end_ms: clip.speech_end_ms, end_ms: clip.end_ms } : null,
      };
    }),
  };
}

/** The finished payload: the answers, the transcripts and the clips are all fair game now. */
function resultPayload(test: TestRow, items: readonly ItemRow[], questions: Map<string, QuestionRow>, clips: Map<string, Clip>) {
  return {
    id: test.id,
    section: test.section,
    kind: test.kind,
    source_exam: test.source_exam,
    status: test.status,
    question_count: test.question_count,
    correct_count: test.correct_count ?? 0,
    score_points: test.score_points ?? 0,
    total_points: test.total_points,
    duration_ms: test.duration_ms,
    pause_count: test.pause_count,
    paused_ms: test.paused_ms,
    finished_at: test.finished_at?.getTime() ?? null,
    items: items.map((i) => {
      const q = questions.get(i.question_id ?? "");
      const clip = i.segment_id ? (clips.get(i.segment_id) ?? null) : null;
      return {
        position: i.position,
        question_id: i.question_id,
        number: i.number,
        points: i.points,
        exam: q?.exam ?? null,
        selected_option: i.selected_option,
        correct_option: q?.correct_option ?? 1,
        is_correct: !!i.is_correct,
        clip: clip ? { audio_key: clip.audio_key, start_ms: clip.start_ms, speech_end_ms: clip.speech_end_ms, end_ms: clip.end_ms } : null,
        transcript: q && q.section === "listening" ? q.stem_text : null,
      };
    }),
  };
}
