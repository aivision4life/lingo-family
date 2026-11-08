// TOPIK II practice (SPEC F12, M6.1; per-question vocabulary M6.2; answer explanation M6.3;
// generation moved to practice time M6.4-ish): question bank CRUD + review, practice sessions,
// attempts. Reading, writing and deleting questions are adult-only; practice (GET session / POST
// attempt) is open to every profile, including kids. The only AI in this feature is the M6.2
// "tap a word" vocabulary and the M6.3 answer explanation. Importing/approving a question (even in
// bulk) never generates either, to keep a ~600-question import free — generation is kicked off
// in the background (`waitUntil`) only for the ~10 questions an actual practice session picks
// (GET /topik/session), plus a manual question create/edit and the review screen's one-question
// "generate now" button (POST .../generate-content) — see worker/services/topikWord.ts and
// topikExplain.ts.
import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { State } from "ts-fsrs";
import { topikSectionSchema } from "../../shared/enums";
import { z } from "zod";
import { applyReview, emptyCardFields } from "../../shared/scheduling";
import {
  TOPIK_ERRORS,
  TOPIK_IMAGE_MAX_BYTES,
  TOPIK_IMAGE_MAX_SIDE,
  TOPIK_SESSION_SIZE,
  topikAttemptRequestSchema,
  topikAudioVerifySchema,
  topikGenerateContentResponseSchema,
  topikQuestionContentSchema,
  topikQuestionInputSchema,
  topikQuestionListQuerySchema,
  topikQuestionSegmentSchema,
  topikQuestionStatsSchema,
  topikQuestionUpdateSchema,
  segmentBoundsError,
  topikSegmentUpdateSchema,
  topikSessionRequestSchema,
  topikVerifyBulkRequestSchema,
  type TopikClip,
  type TopikPracticeQuestion,
  type TopikQuestion,
} from "../../shared/topik";
import { profiles, topik_attempts, topik_audio, topik_cards, topik_questions, topik_segments } from "../../db/schema";
import { readInD1Chunks } from "../lib/d1Chunk";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";
import { runInBackground } from "../lib/background";
import { toCardFields } from "../services/topikCards";
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

/** Escapes LIKE wildcards so user input is matched literally (same rule as `worker/routes/words.ts`). */
const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Clips for a set of questions, in one query. Only the review screen and a practice session ever
 * need them, and both already have the rows in hand.
 */
async function clipsBySegment(db: ReturnType<typeof getDb>, segmentIds: readonly string[]): Promise<Map<string, TopikClip>> {
  const ids = [...new Set(segmentIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ segment: topik_segments, audio: topik_audio })
    .from(topik_segments)
    .innerJoin(topik_audio, eq(topik_audio.id, topik_segments.audio_id))
    .where(inArray(topik_segments.id, ids));
  return new Map(
    rows.map((r) => [
      r.segment.id,
      { audio_key: r.audio.audio_key, start_ms: r.segment.start_ms, speech_end_ms: r.segment.speech_end_ms, end_ms: r.segment.end_ms },
    ]),
  );
}

/** `clip` is only filled in where the caller looked it up — a mutation response leaves it null and
 * the client refetches the list, which does load it. */
const toQuestion = (r: QuestionRow, clip: TopikClip | null = null): TopikQuestion => ({
  id: r.id,
  section: r.section,
  exam: r.exam,
  number: r.number,
  block: r.block,
  instruction: r.instruction,
  points: r.points,
  stem: { text: r.stem_text, image_key: r.stem_image_key },
  options: r.options,
  correct_option: r.correct_option,
  warning: r.warning,
  vocab: r.vocab ?? [],
  explanation_vi: r.explanation_vi,
  key_terms: r.key_terms ?? [],
  vocab_ready: r.vocab_checked_at !== null,
  explain_ready: r.explain_checked_at !== null,
  verified: r.verified,
  created_by_profile: r.created_by_profile,
  created_at: r.created_at.getTime(),
  updated_at: r.updated_at.getTime(),
  audio: clip,
});

/** The practice view of a question: never carries `correct_option`. */
/**
 * A listening question's stem is its transcript, typed in the same Word table as the question, and
 * its `vocab` is generated from that transcript — so both are withheld until the learner has
 * answered, exactly like `correct_option`. Hiding them in the UI would not be enough: they would
 * still be sitting in the session response. They come back with the attempt result.
 */
/**
 * Everything that was withheld while the group was being answered, for every question in it.
 *
 * The group is the clip: `segment_id` is shared by the questions asked about one recording, so no
 * flag has to be kept in step with the data. A question with no clip is a group of one.
 */
async function revealGroup(db: ReturnType<typeof getDb>, profileId: string, question: QuestionRow) {
  const siblings = question.segment_id
    ? await db.select().from(topik_questions).where(eq(topik_questions.segment_id, question.segment_id)).orderBy(asc(topik_questions.number))
    : [question];
  return await Promise.all(
    siblings.map(async (q) => ({
      question_id: q.id,
      number: q.number,
      correct_option: q.correct_option,
      transcript: q.section === "listening" ? q.stem_text : null,
      vocab: q.vocab ?? [],
      explanation_vi: q.explanation_vi,
      key_terms: await resolveKeyTermViews(db, profileId, q.vocab ?? [], q.key_terms ?? []),
      explain_ready: q.explain_checked_at !== null,
    })),
  );
}

const toPracticeQuestion = (r: QuestionRow, clip: TopikClip | null = null): TopikPracticeQuestion => {
  const hideTranscript = r.section === "listening";
  return {
    id: r.id,
    section: r.section,
    exam: r.exam,
    number: r.number,
    block: r.block,
    instruction: r.instruction,
    points: r.points,
    stem: { text: hideTranscript ? null : r.stem_text, image_key: r.stem_image_key },
    options: r.options,
    vocab: hideTranscript ? [] : (r.vocab ?? []),
    vocab_ready: r.vocab_checked_at !== null,
    audio: clip,
    // The clip two questions share is their group (M7.5); a question with none is its own group.
    group_id: r.segment_id ?? r.id,
  };
};

export const topikRoutes = ({ makeLlm }: { makeLlm: MakeLlm }) => {
  /**
   * Starts (background, `waitUntil`) generating/refreshing `row`'s vocabulary and/or answer
   * explanation — whichever `opts` asks for — logging each under `profileId` with no daily cap
   * (`recordUsage`, "topik_vocab" / "topik_explain"). A no-op when no LLM is configured. The
   * explanation is generated from whatever vocabulary comes out of this same run (freshly
   * generated, or the row's existing one when `opts.vocab` is false), since its `key_terms` may
   * only cite lemmas from that list. Best-effort only: if the ~30s background window is cut off
   * (can happen when a practice session picks up several never-studied questions at once), the row
   * is simply left with `vocab_checked_at`/`explain_checked_at` still null — picked up by the next
   * practice session, the review screen's "Tạo dữ liệu AI" button, or `npm run topik-words` /
   * `npm run topik-explain` (M6.4-ish: generation is no longer triggered by import/approve).
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
    // Filter + search + paginate for the review screen (expected to grow to ~600+ rows): `exam`/
    // `block` narrow to one label each, `q` is either free text matched against the stem/options
    // (LIKE on the raw columns — options' JSON text still contains each option's own text verbatim,
    // so this also finds a match inside an option) or, when it is all digits, an exact `number`.
    .get("/topik/questions", zv("query", topikQuestionListQuerySchema), async (c) => {
      const { profile_id, section, verified, exam, block, q, limit, offset } = c.req.valid("query");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      const conditions: SQL[] = [];
      if (section !== undefined) conditions.push(eq(topik_questions.section, section));
      if (verified !== undefined) conditions.push(eq(topik_questions.verified, verified === "1"));
      if (exam) conditions.push(eq(topik_questions.exam, exam));
      if (block) conditions.push(eq(topik_questions.block, block));
      if (q) {
        if (/^\d+$/.test(q)) conditions.push(eq(topik_questions.number, Number(q)));
        else {
          const pattern = likePattern(q);
          conditions.push(or(sql`${topik_questions.stem_text} LIKE ${pattern} ESCAPE '\\'`, sql`${topik_questions.options} LIKE ${pattern} ESCAPE '\\'`)!);
        }
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, totalRow] = await Promise.all([
        db
          .select()
          .from(topik_questions)
          .where(where)
          // Rows with a warning (from import) surface first, per exam group.
          .orderBy(desc(sql`${topik_questions.warning} is not null`), asc(topik_questions.exam), asc(topik_questions.number))
          .limit(limit)
          .offset(offset),
        db.select({ n: count() }).from(topik_questions).where(where).get(),
      ]);
      // The review screen plays a listening question's clip straight from the row.
      const clips = await clipsBySegment(
        db,
        rows.flatMap((r) => (r.segment_id ? [r.segment_id] : [])),
      );
      return c.json({ questions: rows.map((r) => toQuestion(r, r.segment_id ? (clips.get(r.segment_id) ?? null) : null)), total: totalRow?.n ?? 0 });
    })

    /** Values for the exam/block filter dropdowns, scoped to the same `verified` tab so a choice
     * never leads to an empty list. */
    .get(
      "/topik/questions/facets",
      zv("query", z.object({ profile_id: z.string().min(1), section: topikSectionSchema.optional(), verified: z.enum(["0", "1"]).optional() })),
      async (c) => {
      const { profile_id, section, verified } = c.req.valid("query");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      // Scoped to the section as well as the tab: a reading exam label in the listening dropdown
      // would only ever lead to an empty list.
      const where = and(
        section === undefined ? undefined : eq(topik_questions.section, section),
        verified === undefined ? undefined : eq(topik_questions.verified, verified === "1"),
      );
      const [exams, blocks] = await Promise.all([
        db.selectDistinct({ exam: topik_questions.exam }).from(topik_questions).where(where).orderBy(asc(topik_questions.exam)),
        db.selectDistinct({ block: topik_questions.block }).from(topik_questions).where(where).orderBy(asc(topik_questions.block)),
      ]);
      return c.json({ exams: exams.map((e) => e.exam), blocks: blocks.map((b) => b.block) });
      },
    )

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

    /** Approves every question matching a filter without changing their content (the review screen's
     * "approve group"). Never generates vocabulary/explanation (M6.4-ish): with ~600 questions imported
     * at once, approving a whole exam must stay free — generation happens later, per-question, when
     * it is actually picked for a practice session (or via the review screen's own-question button). */
    .post("/topik/questions/verify-bulk", zv("json", topikVerifyBulkRequestSchema.and(z.object({ profile_id: z.string().min(1) }))), async (c) => {
      const body = c.req.valid("json");
      const denied = await requireAdult(c, body.profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      const where = "exam" in body ? eq(topik_questions.exam, body.exam) : and(eq(topik_questions.section, body.section), gte(topik_questions.number, body.from), lte(topik_questions.number, body.to));
      const rows = await db.update(topik_questions).set({ verified: true, updated_at: new Date() }).where(where).returning({ id: topik_questions.id });
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

    // --- Listening audio (M7.1, adults only) --------------------------------------------------
    // One mp3 per exam; a segment is a pair of timestamps into it, so re-cutting never touches the
    // file. None of an exam's questions reach practice until `verified` is set here by hand: a
    // one-clip offset plays perfectly normal audio and would surface only as answers that stop
    // making sense.
    .get("/topik/audio", zv("query", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const { profile_id } = c.req.valid("query");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const rows = await c.env.DB.prepare(
        `SELECT a.*, (SELECT count(*) FROM topik_segments s WHERE s.audio_id = a.id) AS segment_count,
                (SELECT count(*) FROM topik_questions q WHERE q.section = a.section AND q.exam = a.exam) AS question_count,
                (SELECT count(*) FROM topik_questions q WHERE q.section = a.section AND q.exam = a.exam AND q.segment_id IS NULL) AS unassigned_questions
         FROM topik_audio a ORDER BY a.exam`,
      ).all<Record<string, unknown>>();
      return c.json(rows.results.map((r) => ({ ...r, verified: !!r.verified })));
    })

    .get("/topik/audio/:id", idParam, zv("query", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid("param");
      const { profile_id } = c.req.valid("query");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const audio = await c.env.DB.prepare("SELECT * FROM topik_audio WHERE id = ?").bind(id).first<Record<string, unknown>>();
      if (!audio) return c.json(err("not_found"), 404);

      const segments = await c.env.DB.prepare(
        `SELECT s.*, (SELECT group_concat(q.number) FROM topik_questions q WHERE q.segment_id = s.id) AS question_numbers
         FROM topik_segments s WHERE s.audio_id = ? ORDER BY s.idx`,
      )
        .bind(id)
        .all<Record<string, unknown> & { question_numbers: string | null }>();
      const unassigned = await c.env.DB.prepare(
        "SELECT count(*) AS n FROM topik_questions WHERE section = ? AND exam = ? AND segment_id IS NULL",
      )
        .bind(audio.section, audio.exam)
        .first<{ n: number }>();

      return c.json({
        ...audio,
        verified: !!audio.verified,
        unassigned_questions: unassigned?.n ?? 0,
        segments: segments.results.map(({ question_numbers, ...s }) => ({
          ...s,
          questions: (question_numbers ?? "")
            .split(",")
            .filter(Boolean)
            .map(Number)
            .sort((a, b) => a - b),
        })),
      });
    })

    .patch("/topik/segments/:id", idParam, zv("json", topikSegmentUpdateSchema.extend({ profile_id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid("param");
      const { profile_id, ...patch } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      // Read first: a patch may carry one timestamp alone, and only the merged row shows whether
      // the three still run start < speech_end <= end (M7.17 — a mistyped digit used to be saved).
      const current = await db.select().from(topik_segments).where(eq(topik_segments.id, id)).get();
      if (!current) return c.json(err("not_found"), 404);
      const boundsError = segmentBoundsError({ ...current, ...patch });
      if (boundsError) {
        return c.json({ ...err(TOPIK_ERRORS.badBounds), issues: [{ path: "", message: boundsError }] }, 400);
      }
      const [row] = await db.update(topik_segments).set(patch).where(eq(topik_segments.id, id)).returning();
      if (!row) return c.json(err("not_found"), 404);
      // Editing a boundary invalidates the approval: the clips changed since they were checked.
      await db.update(topik_audio).set({ verified: false, updated_at: new Date() }).where(eq(topik_audio.id, row.audio_id));
      return c.json({ ...row, questions: [] });
    })

    .patch("/topik/questions/:id/segment", idParam, zv("json", topikQuestionSegmentSchema.extend({ profile_id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid("param");
      const { profile_id, segment_id } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      const [row] = await db.update(topik_questions).set({ segment_id }).where(eq(topik_questions.id, id)).returning();
      if (!row) return c.json(err("not_found"), 404);
      if (segment_id) {
        const segment = await db.select().from(topik_segments).where(eq(topik_segments.id, segment_id)).get();
        if (segment) await db.update(topik_audio).set({ verified: false, updated_at: new Date() }).where(eq(topik_audio.id, segment.audio_id));
      }
      return c.json(toQuestion(row));
    })

    .patch("/topik/audio/:id", idParam, zv("json", topikAudioVerifySchema.extend({ profile_id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid("param");
      const { profile_id, verified } = c.req.valid("json");
      const denied = await requireAdult(c, profile_id);
      if (denied) return denied;
      const db = getDb(c.env);
      const [row] = await db.update(topik_audio).set({ verified, updated_at: new Date() }).where(eq(topik_audio.id, id)).returning();
      if (!row) return c.json(err("not_found"), 404);
      return c.json({ ...row, verified: !!row.verified });
    })

    // --- Practice -----------------------------------------------------------------------------
    // `profile_id` is optional on purpose: an installed PWA may still be running a build from
    // before `unseen` existed, and it should keep working (it just gets unseen = count and ignores
    // the field) instead of getting a 400 on the screen's only request.
    .get("/topik/blocks", zv("query", z.object({ section: topikSectionSchema, profile_id: z.string().optional() })), async (c) => {
      const { section, profile_id } = c.req.valid("query");
      // One aggregate for the whole screen, never one query per block, against this profile's own
      // cards: "unseen" = no card yet, which is precisely what a session treats as a new question;
      // "mastered" = its card reached ts-fsrs Review, the same definition the vocabulary side uses
      // for "already knows it". Counting unseen from attempts instead (M6.9 through M7.2) made the
      // picker and a real review disagree about the same question, because a "practise anyway"
      // answer writes an attempt but deliberately no card.
      // "Due" is decided here, with the same clock the session uses, so the picker can never
      // promise questions that `buildTopikSession` would then leave out (M7.2).
      const nowMs = resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url).getTime();
      const rows = await c.env.DB.prepare(
        `SELECT q.block, min(q.number) AS "from", max(q.number) AS "to", count(*) AS count,
                sum(CASE WHEN c.id IS NULL THEN 1 ELSE 0 END) AS unseen,
                sum(CASE WHEN c.state = ?3 THEN 1 ELSE 0 END) AS mastered,
                sum(CASE WHEN c.id IS NOT NULL AND c.due <= ?4 THEN 1 ELSE 0 END) AS due,
                sum(CASE WHEN c.id IS NOT NULL AND c.due > ?4 THEN 1 ELSE 0 END) AS later,
                min(CASE WHEN c.id IS NOT NULL AND c.due > ?4 THEN c.due END) AS next_due_at
         FROM topik_questions q
         LEFT JOIN topik_cards c ON c.question_id = q.id AND c.profile_id = ?2
         WHERE q.section = ?1 AND q.verified = 1
           -- Listening counts only what practice can actually serve (M7.1): a block promising
           -- "50 to do" that then starts an empty session is worse than not listing it at all.
           AND (q.section <> 'listening' OR (q.segment_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM topik_audio au WHERE au.section = q.section AND au.exam = q.exam AND au.verified = 1)))
         GROUP BY q.block ORDER BY min(q.number)`,
      )
        .bind(section, profile_id ?? "", State.Review, nowMs)
        .all<{
          block: string;
          from: number;
          to: number;
          count: number;
          unseen: number;
          mastered: number;
          due: number;
          later: number;
          next_due_at: number | null;
        }>();
      return c.json(rows.results.map((r) => ({ section, ...r })));
    })

    .get("/topik/session", zv("query", topikSessionRequestSchema), async (c) => {
      const { profile_id, section, from, to, mode } = c.req.valid("query");
      const db = getDb(c.env);
      // A listening question is only usable once it has a clip AND an adult has approved that
      // exam's boundaries (M7.1): a one-clip offset plays perfectly normal audio, so a wrong
      // mapping is invisible while practising and would surface only as answers that stop making
      // sense. Reading questions have no audio and are unaffected.
      const audioReady =
        section === "listening"
          ? sql`${topik_questions.segment_id} IS NOT NULL AND EXISTS (
                SELECT 1 FROM topik_audio a
                WHERE a.section = ${topik_questions.section} AND a.exam = ${topik_questions.exam} AND a.verified = 1)`
          : undefined;
      const questions = await db
        .select()
        .from(topik_questions)
        .where(
          and(
            eq(topik_questions.section, section),
            eq(topik_questions.verified, true),
            gte(topik_questions.number, from),
            lte(topik_questions.number, to),
            audioReady,
          ),
        )
        .orderBy(asc(topik_questions.number));
      if (questions.length === 0) return c.json({ questions: [] });

      // Chunked: this IN list is every verified question of the chosen block, which grows with the
      // bank (a 21~50 block across several papers is already past D1's 100-parameter ceiling).
      const cardRows = await readInD1Chunks(
        questions.map((q) => q.id),
        (chunk) => db.select().from(topik_cards).where(and(eq(topik_cards.profile_id, profile_id), inArray(topik_cards.question_id, chunk))),
        // One parameter is already spent on profile_id.
        { reserved: 1 },
      );
      const cardByQuestion = new Map(cardRows.map((r) => [r.question_id, toCardFields(r)]));
      const candidates: TopikCandidate[] = questions.map((q) => ({
        question_id: q.id,
        group_id: q.segment_id ?? q.id,
        card: cardByQuestion.get(q.id) ?? null,
      }));

      // How many questions this profile asked for (M6.13); an unknown profile keeps the default.
      const profile = await db.select({ session_size: profiles.session_size }).from(profiles).where(eq(profiles.id, profile_id)).get();
      const sessionIds = buildTopikSession(
        candidates,
        resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url),
        mode,
        profile?.session_size ?? TOPIK_SESSION_SIZE,
      );
      const byId = new Map(questions.map((q) => [q.id, q]));

      // One query for every clip this session needs; a question with no clip never got here (the
      // session query requires one for listening).
      const clipByQuestion = new Map<string, TopikClip>();
      const segmentIds = [...new Set(sessionIds.map((id) => byId.get(id)!.segment_id).filter((x) => x !== null))];
      if (segmentIds.length > 0) {
        const clips = await readInD1Chunks(segmentIds, (chunk) =>
          db
            .select({ segment: topik_segments, audio: topik_audio })
            .from(topik_segments)
            .innerJoin(topik_audio, eq(topik_audio.id, topik_segments.audio_id))
            .where(inArray(topik_segments.id, chunk)),
        );
        const bySegment = new Map(clips.map((c2) => [c2.segment.id, c2]));
        for (const id of sessionIds) {
          const row = byId.get(id)!;
          const found = row.segment_id ? bySegment.get(row.segment_id) : undefined;
          if (found) {
            clipByQuestion.set(id, {
              audio_key: found.audio.audio_key,
              start_ms: found.segment.start_ms,
              speech_end_ms: found.segment.speech_end_ms,
              end_ms: found.segment.end_ms,
            });
          }
        }
      }
      const result = sessionIds.map((id) => toPracticeQuestion(byId.get(id)!, clipByQuestion.get(id) ?? null));

      // M6.4-ish: this is the actual generation trigger — only the handful of questions a real practice
      // session picks ever cost an AI call, never a bulk import/approve of ~600 questions. A
      // question already fully generated (common on a repeat session) costs nothing further.
      for (const id of sessionIds) {
        const row = byId.get(id)!;
        if (!row.vocab_checked_at || !row.explain_checked_at) {
          refreshContent(c, profile_id, row, { vocab: !row.vocab_checked_at, explain: !row.explain_checked_at });
        }
      }
      return c.json({ questions: result });
    })

    /** Polled by the practice screen while a session-triggered (or manually started) generation is
     * still running, and by the review screen after "Tạo dữ liệu AI" — see `topikQuestionContentSchema`. */
    .get("/topik/questions/:id/content", idParam, zv("query", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid("param");
      const { profile_id } = c.req.valid("query");
      const db = getDb(c.env);
      const row = await db.select().from(topik_questions).where(eq(topik_questions.id, id)).get();
      if (!row) return c.json(err("not_found"), 404);
      const key_terms = await resolveKeyTermViews(db, profile_id, row.vocab ?? [], row.key_terms ?? []);
      // M7.1: a listening question's vocabulary comes from its transcript, so it stays hidden until
      // this profile has actually answered the question — the same reason the transcript itself is
      // not in the session response. One cheap lookup, and only while something is still pending.
      const attempted =
        row.section !== "listening" ||
        (await db
          .select({ id: topik_attempts.id })
          .from(topik_attempts)
          .where(and(eq(topik_attempts.profile_id, profile_id), eq(topik_attempts.question_id, id)))
          .limit(1)
          .get()) !== undefined;
      return c.json({
        vocab: attempted ? (row.vocab ?? []) : [],
        vocab_ready: row.vocab_checked_at !== null,
        explanation_vi: row.explanation_vi,
        key_terms,
        explain_ready: row.explain_checked_at !== null,
      } satisfies z.infer<typeof topikQuestionContentSchema>);
    })

    /** One profile's own full history on one question (every session ever, not just the current
     * one) — shown small at the bottom of the practice screen. Never reveals the answer. */
    .get("/topik/questions/:id/stats", idParam, zv("query", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid("param");
      const { profile_id } = c.req.valid("query");
      const db = getDb(c.env);
      const row = await db
        .select({ attempts: count(), correct: sql<number>`sum(${topik_attempts.is_correct})` })
        .from(topik_attempts)
        .where(and(eq(topik_attempts.profile_id, profile_id), eq(topik_attempts.question_id, id)))
        .get();
      return c.json({ attempts: row?.attempts ?? 0, correct: row?.correct ?? 0 } satisfies z.infer<typeof topikQuestionStatsSchema>);
    })

    /** Review screen's per-question "Tạo dữ liệu AI" (adult only): for a question nobody has
     * practiced yet, generates whichever of vocab/explanation it is still missing without waiting
     * for a real practice session. Starts the same background job GET /topik/session would. */
    .post(
      "/topik/questions/:id/generate-content",
      idParam,
      zv("json", z.object({ profile_id: z.string().min(1) })),
      async (c) => {
        const { id } = c.req.valid("param");
        const { profile_id } = c.req.valid("json");
        const denied = await requireAdult(c, profile_id);
        if (denied) return denied;
        const db = getDb(c.env);
        const row = await db.select().from(topik_questions).where(eq(topik_questions.id, id)).get();
        if (!row) return c.json(err("not_found"), 404);
        const needsVocab = !row.vocab_checked_at;
        const needsExplain = !row.explain_checked_at;
        if (needsVocab || needsExplain) refreshContent(c, profile_id, row, { vocab: needsVocab, explain: needsExplain });
        return c.json({ started: needsVocab || needsExplain } satisfies z.infer<typeof topikGenerateContentResponseSchema>);
      },
    )

    .post("/topik/attempts", zv("json", topikAttemptRequestSchema), async (c) => {
      const { profile_id, question_id, selected_option, duration_ms, schedule = true, group_pending = false } = c.req.valid("json");
      const db = getDb(c.env);
      const question = await db.select().from(topik_questions).where(eq(topik_questions.id, question_id)).get();
      if (!question) return c.json(err("not_found"), 404);

      const now = resolveNow(c.env, c.req.header(DEV_NOW_HEADER), c.req.url);
      const existingCard = await db
        .select()
        .from(topik_cards)
        .where(and(eq(topik_cards.profile_id, profile_id), eq(topik_cards.question_id, question_id)))
        .get();
      const is_correct = selected_option === question.correct_option;

      // `schedule: false` is a "practise anyway" answer (M7.2): it happened, so it is recorded,
      // but it must leave the schedule exactly as it was — no card created for a question that is
      // still new, no due date moved on one that was already waiting.
      if (schedule) {
        const fields = existingCard ? toCardFields(existingCard) : emptyCardFields(now);
        const { card } = applyReview(fields, is_correct ? 3 : 1, now);
        if (existingCard) {
          await db.update(topik_cards).set({ ...card, updated_at: now }).where(eq(topik_cards.id, existingCard.id));
        } else {
          await db.insert(topik_cards).values({ profile_id, question_id, ...card });
        }
      }
      await db.insert(topik_attempts).values({
        profile_id,
        question_id,
        section: question.section,
        exam: question.exam,
        number: question.number,
        selected_option,
        is_correct,
        scheduled: schedule,
        duration_ms: duration_ms ?? null,
      });
      // M7.5: while another question about this same recording is still unanswered, the verdict
      // for this one is all that may be sent. The transcript answers the sibling too, and so does
      // the explanation — handing them over now would be handing over a mark. Enforced here, not
      // in the screen: data the screen hides is still data on the device.
      if (group_pending) {
        return c.json({
          is_correct,
          correct_option: question.correct_option,
          explanation_vi: null,
          key_terms: [],
          explain_ready: question.explain_checked_at !== null,
          transcript: null,
          vocab: [],
          group_reveal: [],
        });
      }

      // Only revealed now (the answer is already known at this point) — never in GET /topik/session.
      const key_terms = await resolveKeyTermViews(db, profile_id, question.vocab ?? [], question.key_terms ?? []);
      return c.json({
        is_correct,
        correct_option: question.correct_option,
        explanation_vi: question.explanation_vi,
        key_terms,
        explain_ready: question.explain_checked_at !== null,
        // M7.1: a listening question's transcript (and the words tapped in it) were withheld from
        // the session response so the exercise stayed a listening one. The answer is in now.
        transcript: question.section === "listening" ? question.stem_text : null,
        vocab: question.vocab ?? [],
        // The whole group, so the screen can show one transcript with both explanations under it.
        group_reveal: await revealGroup(db, profile_id, question),
      });
    })

    /**
     * Giving up on a group and reading it instead (M7.5): the questions still unanswered are
     * abandoned by the learner's own deliberate choice, so the transcript and the explanations are
     * handed over for the whole group.
     *
     * Read-only on purpose — no attempt row, no card, nothing in the schedule. Skipping a question
     * is not the same as getting it wrong, and the one thing worse than no data is data that says
     * something that did not happen.
     */
    .get("/topik/questions/:id/reveal", idParam, zv("query", z.object({ profile_id: z.string().min(1) })), async (c) => {
      const db = getDb(c.env);
      const question = await db.select().from(topik_questions).where(eq(topik_questions.id, c.req.valid("param").id)).get();
      if (!question) return c.json(err("not_found"), 404);
      return c.json({ group: await revealGroup(db, c.req.valid("query").profile_id, question) });
    });
};
