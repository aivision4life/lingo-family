// TOPIK II practice (SPEC F12, M6.1; per-question vocabulary M6.2; answer explanation M6.3):
// question bank CRUD + review, practice sessions, attempts. Reading, writing and deleting
// questions are adult-only; practice (GET session / POST attempt) is open to every profile,
// including kids. The only AI in this feature is the M6.2 "tap a word" vocabulary and the M6.3
// answer explanation, both generated once in the background when a question is created/edited/
// approved (never at practice time) — see worker/services/topikWord.ts and topikExplain.ts.
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
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
import { generateTopikExplanationWithCache, resolveExplainImages, resolveKeyTermViews } from "../services/topikExplain";
import type { ExplainInput } from "../services/topikExplainPrompt";
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
  explanation_vi: r.explanation_vi,
  key_terms: r.key_terms ?? [],
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
   * Starts (background, `waitUntil`) generating/refreshing `row`'s vocabulary and/or answer
   * explanation — whichever `opts` asks for — logging each under `profileId` with no daily cap
   * (`recordUsage`, "topik_vocab" / "topik_explain"). A no-op when no LLM is configured. The
   * explanation is generated from whatever vocabulary comes out of this same run (freshly
   * generated, or the row's existing one when `opts.vocab` is false), since its `key_terms` may
   * only cite lemmas from that list. Best-effort only: if the ~30s background window is cut off
   * (can happen approving many questions from one exam at once), the row is simply left with
   * `vocab_checked_at`/`explain_checked_at` still null and picked up later by `npm run topik-words`
   * / `npm run topik-explain`.
   */
  const refreshContent = (c: Context<AppEnv>, profileId: string, row: QuestionRow, opts: { vocab: boolean; explain: boolean }) => {
    const llm = makeLlm(c.env);
    if (!llm) return;
    const db = getDb(c.env);
    const logContext = `${row.exam} #${row.number}`;
    runInBackground(
      c,
      (async () => {
        let vocab = row.vocab ?? [];
        if (opts.vocab) {
          const result = await generateTopikVocabWithCache({
            db,
            llm,
            logContext,
            text: topikVocabSourceText(row),
            beforeLlmCall: () => recordUsage(db, profileId, "topik_vocab"),
          });
          vocab = result.vocab;
          await db.update(topik_questions).set({ vocab, vocab_checked_at: new Date() }).where(eq(topik_questions.id, row.id));
        }
        if (opts.explain) {
          const input: ExplainInput = {
            instruction: row.instruction,
            stem: { text: row.stem_text, image_key: row.stem_image_key },
            options: row.options,
            correct_option: row.correct_option,
            vocab,
          };
          // A stem/option image is fetched and attached for real (never guessed from the correct
          // answer); if any referenced image can't be fetched, no explanation is generated at all
          // rather than one reasoning from a guess — the row is simply left for a later retry.
          const imageResult = await resolveExplainImages(c.env.MEDIA, input);
          if ("error" in imageResult) {
            console.error(`[topik-explain] skipping ${logContext}: ${imageResult.error}`);
          } else {
            const { explanation_vi, key_terms } = await generateTopikExplanationWithCache({
              db,
              llm,
              logContext,
              input,
              images: imageResult.images,
              beforeLlmCall: () => recordUsage(db, profileId, "topik_explain"),
            });
            await db.update(topik_questions).set({ explanation_vi, key_terms, explain_checked_at: new Date() }).where(eq(topik_questions.id, row.id));
          }
        }
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
      // A manual entry starts verified, so its vocabulary + explanation can be generated right away.
      refreshContent(c, profile_id, row!, { vocab: true, explain: true });
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
      // Only once the question is verified (shown in practice). Vocabulary regenerates when it has
      // never been checked or the stem/options text actually changed (an edit that keeps the same
      // text reuses the ai_cache entry anyway, but skipping the call also skips the recordUsage
      // line). The explanation regenerates for the same reasons, plus whenever `correct_option`
      // itself changes — the explanation describes a specific right/wrong answer, so fixing a wrong
      // answer without touching any text must still redo it.
      const vocabTextChanged = topikVocabSourceText(row!) !== topikVocabSourceText(existing);
      const correctChanged = row!.correct_option !== existing.correct_option;
      const needsVocab = row!.verified && (!row!.vocab_checked_at || vocabTextChanged);
      const needsExplain = row!.verified && (!row!.explain_checked_at || vocabTextChanged || correctChanged);
      if (needsVocab || needsExplain) refreshContent(c, profile_id, row!, { vocab: needsVocab, explain: needsExplain });
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
      // Only rows never checked before (an already-verified row being re-approved keeps what it has);
      // vocabulary and explanation are independent here, since a row can already have one but not
      // the other (e.g. an older row from before M6.3 existed).
      if (rows.length > 0) {
        const needRows = await db
          .select()
          .from(topik_questions)
          .where(
            and(
              inArray(topik_questions.id, rows.map((r) => r.id)),
              or(isNull(topik_questions.vocab_checked_at), isNull(topik_questions.explain_checked_at)),
            ),
          );
        for (const row of needRows) {
          refreshContent(c, body.profile_id, row, { vocab: !row.vocab_checked_at, explain: !row.explain_checked_at });
        }
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
      // Only revealed now (the answer is already known at this point) — never in GET /topik/session.
      const key_terms = await resolveKeyTermViews(db, profile_id, question.vocab ?? [], question.key_terms ?? []);
      return c.json({ is_correct, correct_option: question.correct_option, explanation_vi: question.explanation_vi, key_terms });
    });
};
