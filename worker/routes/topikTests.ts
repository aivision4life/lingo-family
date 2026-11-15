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
//
// A sitting covers a **range** of question numbers (M7.14), never "a number of questions": the
// three shortcut buttons on the picker fill a range in, so there is one input shape here. The range
// is widened to whole groups before anything is drawn, and a hole inside it refuses the sitting
// outright rather than quietly handing over a shorter paper.
//
// The clock is the server's (M7.13). A sitting is drawn with no deadline at all; `POST .../start`
// fixes `length_ms` and `ends_at`, `POST .../clock` pauses and resumes, and nothing the client
// reports about time is believed. There is no scheduler: a paper whose time ran out while nobody
// was looking is submitted by `expireOverdueTests`, called on the reads that would show it.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { topikSectionSchema } from "../../shared/enums";
import { applyReview, emptyCardFields } from "../../shared/scheduling";
import {
  topikGroupId,
  topikGroupsOf,
  topikTestAnswerSchema,
  topikTestCreateSchema,
  topikTestFinishSchema,
  topikTestPauseSchema,
  topikTestRangeQuerySchema,
} from "../../shared/topik";
import { expandToGroups, missingNumber, rangeCount, type NumberRange, type QuestionGroup } from "../../shared/topikRange";
import {
  isExpired,
  pausedClock,
  pausedTotalMs,
  readingDurationMs,
  resumedClock,
  shouldAbandonPaused,
  startedClock,
  tapeLengthMs,
  type TestClock,
} from "../../shared/topikClock";
import { topik_attempts, topik_audio, topik_cards, topik_questions, topik_segments, topik_test_items, topik_tests } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { DEV_NOW_HEADER, resolveNow } from "../lib/devNow";
import { requireAdult } from "../lib/access";
import { zv } from "../lib/validate";
import { readInD1Chunks, writeInD1Chunks } from "../lib/d1Chunk";
import { audioSpan, isContiguousFromOne, lengthOptions, pointsOf, scoreTest } from "../services/topikTest";
import { mixedLengthOptions, planMixedTest, reachableLength, type MixedCandidate } from "../services/topikMixed";
import { answeredQuestionIds, masteredQuestionIds } from "../services/topikAnswered";
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
      // The picker is where a sitting whose time quietly ran out shows up as history.
      await expireOverdueTests(db, profile_id, resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url));

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
        from_number: h.from_number,
        to_number: h.to_number,
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

      // Both sections have a mixed mode now (M7.11); the groups are just different (clip vs question).
      const candidates = await mixedCandidates(db, section);
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
    /**
     * What a range would really be (M7.14) — asked on every keystroke while it is typed, so it is
     * **read-only**: it SELECTs, works out the widening and the length, and creates no sitting.
     */
    .get("/topik/tests/range", zv("query", topikTestRangeQuerySchema), async (c) => {
      const { section, kind, exam, from, to } = c.req.valid("query");
      const db = getDb(c.env);
      if (kind !== "mixed" && !exam) return c.json(err("exam_required"), 400);

      const plan =
        kind === "mixed" ? await planRangeForMixed(db, section, { from, to }) : await planRangeForPaper(db, section, exam!, { from, to });

      const added: number[] = [];
      for (let n = plan.range.from; n <= plan.range.to; n++) if (n < from || n > to) added.push(n);

      return c.json({
        from: plan.range.from,
        to: plan.range.to,
        expanded: plan.expanded,
        added,
        question_count: rangeCount(plan.range),
        missing_number: plan.missing,
        // A range with a hole has no honest length to report: the sitting cannot start anyway.
        length_ms: plan.missing === null ? await rangeLengthMs(db, section, kind, plan.questions) : 0,
      });
    })

    .post("/topik/tests", zv("json", topikTestCreateSchema), async (c) => {
      const { profile_id, section, kind, exam, from, to } = c.req.valid("json");
      const db = getDb(c.env);

      // Two ways to choose the questions, one way to sit them: a test owns a list of questions, so
      // the mixed mode differs only in how that list is filled.
      const picked =
        kind === "mixed"
          ? await drawMixed(db, profile_id, section, { from, to })
          : await takePaper(db, section, exam!, { from, to });
      if ("error" in picked) return c.json(picked.error, 400);
      const chosen = picked.questions;
      const range = picked.range;

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
          from_number: range.from,
          to_number: range.to,
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

      // How long this paper gets is settled now, with the questions that are actually in it — the
      // screen can then say "20 câu · 28:00" before the clock is started, and editing a question's
      // clip later cannot change a sitting that has already been drawn. Only `ends_at` waits for
      // the start.
      const length_ms = await paperLengthMs(db, test!, chosen, clips);
      await db.update(topik_tests).set({ length_ms }).where(eq(topik_tests.id, test!.id));

      return c.json(
        runPayload({ ...test!, length_ms }, chosen, clips, new Map(), resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url)),
        201,
      );
    })

    .get("/topik/tests/:id", idParam, zv("query", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const db = getDb(c.env);
      const now = resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url);
      // Opening a paper whose time ran out while the phone was away: it is graded here, before it
      // is read, so what comes back is the result and not a sitting that could still be answered.
      await expireOverdueTests(db, c.req.valid("query").profile_id, now);
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
        return c.json(runPayload(test, chosen, clips, new Map(items.map((i) => [i.position, i.selected_option])), now));
      }
      return c.json(resultPayload(test, items, questions, clips));
    })

    /**
     * Starting the clock (M7.13) — the "Bắt đầu làm bài" button, and the tap that unlocks the tape.
     *
     * Deliberately separate from drawing the paper: a sitting can sit on screen while the network
     * is slow or an image is still loading without losing a second of exam time. Calling it twice
     * changes nothing, so a double tap or a replayed request cannot shorten the paper.
     */
    .post("/topik/tests/:id/start", idParam, zv("json", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const db = getDb(c.env);
      const now = resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url);
      const test = await db.select().from(topik_tests).where(eq(topik_tests.id, c.req.valid("param").id)).get();
      if (!test || test.profile_id !== c.req.valid("json").profile_id) return c.json(err("not_found"), 404);
      if (test.status !== "running") return c.json(err("topik_test_not_running"), 409);
      if (test.ends_at !== null) return c.json(clockView(test, now));

      // Settled when the paper was drawn; recomputed only for a sitting from before that (M7.13).
      const length = test.length_ms ?? (await paperLengthMs(db, test));
      const clock = startedClock(clockOf(test), length, now.getTime());
      const [started] = await db
        .update(topik_tests)
        .set({ started_at: new Date(clock.started_at), length_ms: clock.length_ms, ends_at: new Date(clock.ends_at!), paused_at: null })
        .where(eq(topik_tests.id, test.id))
        .returning();
      return c.json(clockView(started!, now));
    })

    /**
     * Pausing and resuming.
     *
     * A pause costs no exam time (`resumedClock` pushes `ends_at` out by the whole pause), which is
     * what makes the strict wall-clock rule liveable: a child needing something is not a reason to
     * lose the paper. Every pause is counted, and the result says the sitting was not under exam
     * conditions.
     */
    .post("/topik/tests/:id/clock", idParam, zv("json", topikTestPauseSchema), async (c) => {
      const { profile_id, paused } = c.req.valid("json");
      const db = getDb(c.env);
      const now = resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url);
      const test = await db.select().from(topik_tests).where(eq(topik_tests.id, c.req.valid("param").id)).get();
      if (!test || test.profile_id !== profile_id) return c.json(err("not_found"), 404);
      if (test.status !== "running") return c.json(err("topik_test_not_running"), 409);
      if (test.ends_at === null) return c.json(err("topik_test_not_started"), 409);

      const clock = paused ? pausedClock(clockOf(test), now.getTime()) : resumedClock(clockOf(test), now.getTime());
      const [updated] = await db
        .update(topik_tests)
        .set({
          ends_at: clock.ends_at === null ? null : new Date(clock.ends_at),
          paused_at: clock.paused_at === null ? null : new Date(clock.paused_at),
          paused_ms: clock.paused_ms,
          pause_count: clock.pause_count,
        })
        .where(eq(topik_tests.id, test.id))
        .returning();
      return c.json(clockView(updated!, now));
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
      const { profile_id, answers } = c.req.valid("json");
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

      const { finished, graded, questions } = await gradeAndFinish(db, test, now, false);
      const clips = await clipsFor(db, graded.map((i) => i.segment_id).filter((s): s is string => s !== null));
      return c.json(resultPayload(finished, graded, questions, clips));
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
/** The clock as `shared/topikClock.ts` wants it: plain numbers, no `Date`s. */
function clockOf(test: TestRow): TestClock {
  return {
    started_at: test.started_at.getTime(),
    length_ms: test.length_ms,
    ends_at: test.ends_at?.getTime() ?? null,
    paused_at: test.paused_at?.getTime() ?? null,
    paused_ms: test.paused_ms,
    pause_count: test.pause_count,
  };
}

/** What the client needs to run its own countdown, plus the server's clock to measure it against. */
const clockView = (test: TestRow, now: Date) => ({ ...clockOf(test), server_now: now.getTime() });

/**
 * How long this paper gets, fixed once when the clock starts.
 *
 * Reading has no recording, so the real exam's rate decides. A listening paper is as long as what
 * it plays: one span of one file for an original paper, every clip back to back for a mixed one —
 * the same `tapeLengthMs` the client stitches the tape with, so the deadline and the last clip's
 * end land in the same place.
 */
async function paperLengthMs(db: Db, test: TestRow, questions?: readonly QuestionRow[], known?: Map<string, Clip>): Promise<number> {
  if (test.section === "reading") return readingDurationMs(test.question_count);

  // The caller that has just drawn the paper passes its questions and clips in; anything else reads
  // them back from the sitting's own items.
  const used = questions
    ? questions.map((q) => (q.segment_id ? known?.get(q.segment_id) : undefined)).filter((c): c is Clip => !!c)
    : await (async () => {
        const items = await db
          .select()
          .from(topik_test_items)
          .where(eq(topik_test_items.test_id, test.id))
          .orderBy(asc(topik_test_items.position));
        const clips = await clipsFor(db, items.map((i) => i.segment_id).filter((x): x is string => x !== null));
        return items.map((i) => (i.segment_id ? clips.get(i.segment_id) : undefined)).filter((c): c is Clip => !!c);
      })();
  if (test.kind === "original") {
    const span = audioSpan(used);
    return span ? Math.max(0, span.end_ms - span.start_ms) : 0;
  }
  return tapeLengthMs(used);
}

type GradedItem = ItemRow & { is_correct: boolean };

/**
 * Grading a sitting and closing it: the one path, whether the learner pressed submit or the time
 * simply ran out (M7.13).
 *
 * The time written down is the server's own: wall clock from the start, the pauses it recorded,
 * and — for an auto-submit — nothing that depends on a browser having been there to report it.
 */
async function gradeAndFinish(
  db: Db,
  test: TestRow,
  now: Date,
  auto: boolean,
): Promise<{ finished: TestRow; graded: GradedItem[]; questions: Map<string, QuestionRow> }> {
  const items = await db.select().from(topik_test_items).where(eq(topik_test_items.test_id, test.id)).orderBy(asc(topik_test_items.position));
  const questions = await questionsOf(db, items.map((i) => i.question_id));

  const graded: GradedItem[] = items.map((i) => {
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
      .where(and(eq(topik_cards.profile_id, test.profile_id), eq(topik_cards.question_id, q.id)))
      .get();
    const { card } = applyReview(existing ? toCardFields(existing) : emptyCardFields(now), g.is_correct ? 3 : 1, now);
    if (existing) await db.update(topik_cards).set({ ...card, updated_at: now }).where(eq(topik_cards.id, existing.id));
    else await db.insert(topik_cards).values({ profile_id: test.profile_id, question_id: q.id, ...card });

    await db.insert(topik_attempts).values({
      profile_id: test.profile_id,
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

  const clock = clockOf(test);
  // An auto-submit happens at the deadline, not whenever the sweep noticed it: a paper that ran out
  // at 21:00 and is opened at 23:00 took its own length, not two hours.
  const closedAt = auto && clock.ends_at !== null ? clock.ends_at : now.getTime();
  const score = scoreTest(graded.map((g) => ({ points: g.points, is_correct: g.is_correct })));
  const [finished] = await db
    .update(topik_tests)
    .set({
      status: "finished",
      finished_at: new Date(closedAt),
      duration_ms: Math.max(0, closedAt - clock.started_at),
      paused_ms: pausedTotalMs(clock, closedAt),
      pause_count: clock.pause_count,
      paused_at: null,
      auto_submitted: auto,
      correct_count: score.correct_count,
      score_points: score.score_points,
    })
    .where(eq(topik_tests.id, test.id))
    .returning();
  return { finished: finished!, graded, questions };
}

/**
 * Closing the sittings whose time ran out while nobody was looking.
 *
 * There is no scheduler on a free plan, and there does not need to be one: the only places a stale
 * sitting can be seen are the picker and the sitting's own page, so both sweep first. Out of time
 * means graded — the answers are already in D1, given one by one as they were chosen, so marking
 * them is more honest than throwing a half-finished paper away. A paper that is *paused* is not out
 * of time at all, however long it has been; but a pause nobody ever lifted is abandoned after a day,
 * because a `running` sitting is one that can still be answered.
 */
async function expireOverdueTests(db: Db, profileId: string, now: Date): Promise<void> {
  const running = await db
    .select()
    .from(topik_tests)
    .where(and(eq(topik_tests.profile_id, profileId), eq(topik_tests.status, "running")));

  for (const test of running) {
    const clock = clockOf(test);
    if (isExpired(clock, now.getTime())) await gradeAndFinish(db, test, now, true);
    else if (shouldAbandonPaused(clock, now.getTime())) await db.update(topik_tests).set({ status: "abandoned" }).where(eq(topik_tests.id, test.id));
  }
}

type QuestionRow = typeof topik_questions.$inferSelect;
type TestRow = typeof topik_tests.$inferSelect;
type ItemRow = typeof topik_test_items.$inferSelect;
type Clip = { audio_key: string; start_ms: number; speech_end_ms: number; end_ms: number };

type Picked =
  | { questions: QuestionRow[]; range: NumberRange }
  | { error: { error: string; missing_position?: number; missing_number?: number } };

/** The groups of a paper, from the one definition every range widening shares (M7.24). */
const groupsOf = (questions: readonly QuestionRow[]): QuestionGroup[] => topikGroupsOf(questions);

type RangePlan = { range: NumberRange; expanded: boolean; missing: number | null; questions: QuestionRow[] };

/**
 * What a range means on one paper: widened to whole groups, then checked for holes.
 *
 * Shared by the preview and the real draw, so the screen's promise and the sitting are decided by
 * one piece of code.
 */
async function planRangeForPaper(db: Db, section: "reading" | "listening", exam: string, asked: NumberRange): Promise<RangePlan> {
  const all = await db
    .select()
    .from(topik_questions)
    .where(and(eq(topik_questions.section, section), eq(topik_questions.exam, exam), readyQuestions(section)))
    .orderBy(asc(topik_questions.number));

  const range = expandToGroups(asked, groupsOf(all));
  const missing = missingNumber(range, new Set(all.map((q) => q.number)));
  return {
    range,
    expanded: range.expanded,
    missing,
    questions: all.filter((q) => q.number >= range.from && q.number <= range.to),
  };
}

/** One original paper, over the asked range. */
async function takePaper(db: Db, section: "reading" | "listening", exam: string, asked: NumberRange): Promise<Picked> {
  const plan = await planRangeForPaper(db, section, exam, asked);
  if (plan.missing !== null) return { error: { ...err("topik_test_missing_number"), missing_number: plan.missing } };
  if (plan.questions.length === 0) return { error: err("topik_test_too_short") };
  return { questions: plan.questions, range: plan.range };
}

/**
 * A mixed paper: every position drawn from the whole bank, preferring questions this profile has
 * not met lately (`planMixedTest` has the rules). The failure carries the position the bank ran
 * out at — "the bank has nothing for question 23" is actionable; "too short" is not.
 */
async function drawMixed(db: Db, profileId: string, section: "reading" | "listening", asked: NumberRange): Promise<Picked> {
  const candidates = await mixedCandidates(db, section);
  const range = expandToGroups(asked, candidates.map((c) => c.numbers));

  // The draw ranks what is still to be learnt first (M7.28), so it reads the two definitions the
  // rest of the app already uses: "đã làm" (practice or a sitting) and "thuộc" (the card reached
  // ts-fsrs Review, exactly what the block picker's bar shows).
  const [seen, answered, mastered] = await Promise.all([
    seenRanks(db, profileId, section),
    answeredQuestionIds(db, profileId, section),
    masteredQuestionIds(db, profileId, section),
  ]);
  const plan = planMixedTest({ candidates, from: range.from, to: range.to, seen, answered, mastered, random: Math.random });
  if (!plan.ok) return { error: { ...err("topik_test_bank_short"), missing_position: plan.missingPosition } };

  const rows = await questionsOf(db, plan.picks.map((p) => p.question_id));
  const questions = plan.picks.map((p) => rows.get(p.question_id)).filter((q): q is QuestionRow => !!q);
  if (questions.length !== plan.picks.length) return { error: { ...err("topik_test_bank_short"), missing_position: range.from } };
  return { questions: questions.sort((a, b) => a.number - b.number), range };
}

/**
 * The same plan for the mixed card: the widening takes the **union** of every paper's groups, since
 * the draw may land on the paper that pairs a number its neighbour leaves alone.
 */
async function planRangeForMixed(db: Db, section: "reading" | "listening", asked: NumberRange): Promise<RangePlan> {
  const candidates = await mixedCandidates(db, section);
  const range = expandToGroups(asked, candidates.map((c) => c.numbers));
  const plan = planMixedTest({ candidates, from: range.from, to: range.to, seen: new Map(), random: () => 0 });
  if (!plan.ok) return { range, expanded: range.expanded, missing: plan.missingPosition, questions: [] };

  const rows = await questionsOf(db, plan.picks.map((p) => p.question_id));
  return {
    range,
    expanded: range.expanded,
    missing: null,
    questions: plan.picks.map((p) => rows.get(p.question_id)).filter((q): q is QuestionRow => !!q),
  };
}

/**
 * How long a range would run, for the preview — the same arithmetic `paperLengthMs` uses once the
 * sitting exists, over the questions the plan picked rather than over stored items.
 */
async function rangeLengthMs(db: Db, section: "reading" | "listening", kind: "original" | "mixed", questions: readonly QuestionRow[]): Promise<number> {
  if (section === "reading") return readingDurationMs(questions.length);
  const clips = await clipsFor(db, questions.map((q) => q.segment_id).filter((x): x is string => x !== null));
  const used = questions.map((q) => (q.segment_id ? clips.get(q.segment_id) : undefined)).filter((c): c is Clip => !!c);
  if (kind === "original") {
    const span = audioSpan(used);
    return span ? Math.max(0, span.end_ms - span.start_ms) : 0;
  }
  return tapeLengthMs(used);
}

/**
 * What a mixed draw may take, as groups (M7.11).
 *
 * Listening groups by the clip: two questions about one recording are one unit, because the tape
 * plays once. Reading groups by its passage once the bank has pairs in it (19-20 and friends,
 * M7.21) — the comment here used to say reading had none, and a mixed sitting would have drawn one
 * half of a pair and left the other behind. Both sections now ask `topikGroupId`.
 */
async function mixedCandidates(db: Db, section: "reading" | "listening"): Promise<MixedCandidate[]> {
  const rows = await db
    .select({
      id: topik_questions.id,
      exam: topik_questions.exam,
      number: topik_questions.number,
      segment_id: topik_questions.segment_id,
      group_key: topik_questions.group_key,
    })
    .from(topik_questions)
    .where(and(eq(topik_questions.section, section), readyQuestions(section)))
    .orderBy(asc(topik_questions.number));

  const byGroup = new Map<string, MixedCandidate>();
  for (const r of rows) {
    // A listening question with no clip never passes `readyQuestions`, so the group a listening
    // row lands in is always its clip; for reading it is the passage's key, or the question alone.
    const groupId = topikGroupId(r);
    const found = byGroup.get(groupId) ?? { group_id: groupId, exam: r.exam, numbers: [], question_ids: [] };
    found.numbers.push(r.number);
    found.question_ids.push(r.id);
    byGroup.set(groupId, found);
  }
  return [...byGroup.values()];
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
function runPayload(
  test: TestRow,
  questions: readonly QuestionRow[],
  clips: Map<string, Clip>,
  answered: Map<number, number | null>,
  now: Date,
) {
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
    ...clockView(test, now),
    from_number: test.from_number,
    to_number: test.to_number,
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
        // Questions about one clip, or one passage, are one screen (M7.5/M7.21).
        group_id: topikGroupId(q),
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
    auto_submitted: test.auto_submitted,
    from_number: test.from_number,
    to_number: test.to_number,
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
        instruction: q?.instruction ?? null,
        // A listening stem is the transcript, which already has its own field above.
        stem: q && q.section === "reading" ? { text: q.stem_text, image_key: q.stem_image_key } : null,
        options: q?.options ?? null,
      };
    }),
  };
}
