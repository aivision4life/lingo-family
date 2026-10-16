// TOPIK II practice (SPEC F12, M6.1; per-question vocabulary M6.2): question bank CRUD + review,
// practice sessions, attempts. Reading, writing and deleting questions are adult-only; practice
// (GET session / POST attempt) is open to every profile, including kids. The only AI in this
// feature is the M6.2 "tap a word" vocabulary, generated once in the background when a question is
// created/edited/approved (never at practice time) — see worker/services/topikWord.ts.
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { applyReview, emptyCardFields, type CardFields } from "../../shared/scheduling";
import {
  TOPIK_ERRORS,
  TOPIK_IMAGE_MAX_BYTES,
  TOPIK_IMAGE_MAX_SIDE,
  topikAttemptRequestSchema,
  topikQuestionInputSchema,
  topikQuestionUpdateSchema,
  topikSessionRequestSchema,
  topikVerifyBulkRequestSchema,
  type TopikPracticeQuestion,
  type TopikQuestion,
} from "../../shared/topik";
import { topik_attempts, topik_cards, topik_questions } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";
import { runInBackground } from "../lib/background";
import { DEV_NOW_HEADER, resolveNow } from "../lib/devNow";
import { recordUsage } from "../lib/quota";
import { zv } from "../lib/validate";
import type { MakeLlm } from "./words";
import { buildTopikSession, type TopikCandidate } from "../services/topikScheduling";
import { generateTopikVocabWithCache, topikVocabSourceText } from "../services/topikWord";
import { storeUploadedImage } from "../services/imageUpload";

type QuestionRow = typeof topik_questions.$inferSelect;
const idParam = zv("param", z.object({ id: z.string().min(1) }));
const err = (error: string) => ({ error });

const toQuestion = (r: QuestionRow): TopikQuestion => ({
  id: r.id,
  section: r.section,
  exam: r.exam,
  number: r.number,
  block: r.block,
  instruction: r.instruction,
  stem: { text: r.stem_text, image_key: r.stem_image_key },
  options: r.options,
  correct_option: r.correct_option,
  warning: r.warning,
  vocab: r.vocab ?? [],
  verified: r.verified,
  created_by_profile: r.created_by_profile,
  created_at: r.created_at.getTime(),
  updated_at: r.updated_at.getTime(),
});

/** The practice view of a question: never carries `correct_option`. */
const toPracticeQuestion = (r: QuestionRow): TopikPracticeQuestion => ({
  id: r.id,
  section: r.section,
  exam: r.exam,
  number: r.number,
  block: r.block,
  instruction: r.instruction,
  stem: { text: r.stem_text, image_key: r.stem_image_key },
  options: r.options,
  vocab: r.vocab ?? [],
});

const toCardFields = (r: typeof topik_cards.$inferSelect): CardFields => ({
  due: r.due,
  stability: r.stability,
  difficulty: r.difficulty,
  elapsed_days: r.elapsed_days,
  scheduled_days: r.scheduled_days,
  learning_steps: r.learning_steps,
  reps: r.reps,
  lapses: r.lapses,
  state: r.state,
  last_review: r.last_review,
});

export const topikRoutes = ({ makeLlm }: { makeLlm: MakeLlm }) => {
  /**
   * Starts (background, `waitUntil`) generating/refreshing `row`'s vocabulary, logging the call
   * under `profileId` with no daily cap (`recordUsage`, M6.2). A no-op when no LLM is configured,
   * or when `row` has nothing to tokenize. Best-effort only: if the ~30s background window is cut
   * off (can happen approving many questions from one exam at once), the row is simply left with
   * `vocab_checked_at` still null and picked up later by `npm run topik-words`.
   */
  const refreshVocab = (c: Context<AppEnv>, profileId: string, row: QuestionRow) => {
    const llm = makeLlm(c.env);
    if (!llm) return;
    const db = getDb(c.env);
    const text = topikVocabSourceText(row);
    runInBackground(
      c,
      (async () => {
        const { vocab } = await generateTopikVocabWithCache({
          db,
          llm,
          logContext: `${row.exam} #${row.number}`,
          text,
          beforeLlmCall: () => recordUsage(db, profileId, "topik_vocab"),
        });
        await db.update(topik_questions).set({ vocab, vocab_checked_at: new Date() }).where(eq(topik_questions.id, row.id));
      })(),
    );
  };

  return new Hono<AppEnv>()
    // --- Question bank (adult only to write; reading the full bank, incl. unverified, is also adult-only — it's management, not practice) ---
    .get("/topik/questions", zv("query", z.object({ profile_id: z.string().min(1), verified: z.enum(["0", "1"]).optional() })), async (c) => {
      const { profile_id, verified } = c.req.valid("query");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      const where = verified === undefined ? undefined : eq(topik_questions.verified, verified === "1");
      const rows = await db
        .select()
        .from(topik_questions)
        .where(where)
        // Rows with a warning (from import) surface first, per exam group.
        .orderBy(desc(sql`${topik_questions.warning} is not null`), asc(topik_questions.exam), asc(topik_questions.number));
      return c.json(rows.map(toQuestion));
    })

    .post("/topik/questions", zv("json", topikQuestionInputSchema.extend({ profile_id: z.string().min(1) })), async (c) => {
      const { profile_id, stem, options, ...rest } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      const existing = await db
        .select({ id: topik_questions.id })
        .from(topik_questions)
        .where(and(eq(topik_questions.section, rest.section), eq(topik_questions.exam, rest.exam), eq(topik_questions.number, rest.number)))
        .get();
      if (existing) return c.json(err(TOPIK_ERRORS.duplicate), 409);
      const [row] = await db
        .insert(topik_questions)
        .values({ ...rest, stem_text: stem.text, stem_image_key: stem.image_key, options, verified: true, created_by_profile: profile_id })
        .returning();
      // A manual entry starts verified, so its vocabulary can be generated right away.
      refreshVocab(c, profile_id, row!);
      return c.json(toQuestion(row!), 201);
    })

    .patch("/topik/questions/:id", idParam, zv("json", topikQuestionUpdateSchema.extend({ profile_id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid("param");
      const { profile_id, stem, options, ...rest } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      const existing = await db.select().from(topik_questions).where(eq(topik_questions.id, id)).get();
      if (!existing) return c.json(err("not_found"), 404);
      const [row] = await db
        .update(topik_questions)
        .set({
          ...rest,
          ...(stem !== undefined ? { stem_text: stem.text, stem_image_key: stem.image_key } : {}),
          ...(options !== undefined ? { options } : {}),
          updated_at: new Date(),
        })
        .where(eq(topik_questions.id, id))
        .returning();
      // Only once the question is verified (shown in practice), and only when it has never been
      // checked or its text actually changed since then — an edit that keeps the same text reuses
      // the ai_cache entry anyway, but skipping the call here also skips the recordUsage log line.
      if (row!.verified && (!row!.vocab_checked_at || topikVocabSourceText(row!) !== topikVocabSourceText(existing))) {
        refreshVocab(c, profile_id, row!);
      }
      return c.json(toQuestion(row!));
    })

    .delete("/topik/questions/:id", idParam, zv("json", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid("param");
      const { profile_id } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      const deleted = await db.delete(topik_questions).where(eq(topik_questions.id, id)).returning({ id: topik_questions.id });
      if (deleted.length === 0) return c.json(err("not_found"), 404);
      return c.body(null, 204);
    })

    /** Approves every question matching a filter without changing their content (the review screen's "approve group"). */
    .post("/topik/questions/verify-bulk", zv("json", topikVerifyBulkRequestSchema.and(z.object({ profile_id: z.string().min(1) }))), async (c) => {
      const body = c.req.valid("json");
      const denied = await requireAdult(c, body.profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      const where = "exam" in body ? eq(topik_questions.exam, body.exam) : and(eq(topik_questions.section, body.section), gte(topik_questions.number, body.from), lte(topik_questions.number, body.to));
      const rows = await db.update(topik_questions).set({ verified: true, updated_at: new Date() }).where(where).returning({ id: topik_questions.id });
      // Only rows never checked before (an already-verified row being re-approved keeps its vocab).
      if (rows.length > 0) {
        const needVocab = await db
          .select()
          .from(topik_questions)
          .where(and(inArray(topik_questions.id, rows.map((r) => r.id)), isNull(topik_questions.vocab_checked_at)));
        for (const row of needVocab) refreshVocab(c, body.profile_id, row);
      }
      return c.json({ verified: rows.length });
    })

    /** Stem/option photo, reused by the manual form and the review screen (M6.1: looser size limit than other uploads). */
    .post("/topik/questions/upload-image", zv("query", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const { profile_id } = c.req.valid("query");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const stored = await storeUploadedImage(c.env.MEDIA, bytes, type, { maxSide: TOPIK_IMAGE_MAX_SIDE, maxBytes: TOPIK_IMAGE_MAX_BYTES });
      if (!stored) return c.json(err("invalid_image"), 400);
      return c.json({ image_key: stored.key });
    })

    // --- Practice -----------------------------------------------------------------------------
    .get("/topik/blocks", zv("query", z.object({ section: z.enum(["reading"]) })), async (c) => {
      const { section } = c.req.valid("query");
      const rows = await c.env.DB.prepare(
        `SELECT block, min(number) AS "from", max(number) AS "to", count(*) AS count
         FROM topik_questions WHERE section = ?1 AND verified = 1 GROUP BY block ORDER BY min(number)`,
      )
        .bind(section)
        .all<{ block: string; from: number; to: number; count: number }>();
      return c.json(rows.results.map((r) => ({ section, ...r })));
    })

    .get("/topik/session", zv("query", topikSessionRequestSchema), async (c) => {
      const { profile_id, section, from, to } = c.req.valid("query");
      const db = getDb(c.env);
      const questions = await db
        .select()
        .from(topik_questions)
        .where(and(eq(topik_questions.section, section), eq(topik_questions.verified, true), gte(topik_questions.number, from), lte(topik_questions.number, to)))
        .orderBy(asc(topik_questions.number));
      if (questions.length === 0) return c.json({ questions: [] });

      const cardRows = await db
        .select()
        .from(topik_cards)
        .where(and(eq(topik_cards.profile_id, profile_id), inArray(topik_cards.question_id, questions.map((q) => q.id))));
      const cardByQuestion = new Map(cardRows.map((r) => [r.question_id, toCardFields(r)]));
      const candidates: TopikCandidate[] = questions.map((q) => ({ question_id: q.id, card: cardByQuestion.get(q.id) ?? null }));

      const sessionIds = buildTopikSession(candidates, resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url));
      const byId = new Map(questions.map((q) => [q.id, q]));
      const result = sessionIds.map((id) => toPracticeQuestion(byId.get(id)!));
      return c.json({ questions: result });
    })

    .post("/topik/attempts", zv("json", topikAttemptRequestSchema), async (c) => {
      const { profile_id, question_id, selected_option, duration_ms } = c.req.valid("json");
      const db = getDb(c.env);
      const question = await db.select().from(topik_questions).where(eq(topik_questions.id, question_id)).get();
      if (!question) return c.json(err("not_found"), 404);

      const now = resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url);
      const existingCard = await db
        .select()
        .from(topik_cards)
        .where(and(eq(topik_cards.profile_id, profile_id), eq(topik_cards.question_id, question_id)))
        .get();
      const fields = existingCard ? toCardFields(existingCard) : emptyCardFields(now);
      const is_correct = selected_option === question.correct_option;
      const { card } = applyReview(fields, is_correct ? 3 : 1, now);

      if (existingCard) {
        await db.update(topik_cards).set({ ...card, updated_at: now }).where(eq(topik_cards.id, existingCard.id));
      } else {
        await db.insert(topik_cards).values({ profile_id, question_id, ...card });
      }
      await db.insert(topik_attempts).values({
        profile_id,
        question_id,
        section: question.section,
        exam: question.exam,
        number: question.number,
        selected_option,
        is_correct,
        duration_ms: duration_ms ?? null,
      });
      return c.json({ is_correct, correct_option: question.correct_option });
    });
};
