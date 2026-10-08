import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { LEARN_LANGS } from "../../shared/enums";
import { answerRequestSchema, queueQuerySchema, summaryQuerySchema, type ReviewSummary } from "../../shared/review";
import { applyReview, localDayStart, type CardFields } from "../../shared/scheduling";
import { cards, review_logs, words } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { DEV_NOW_HEADER, resolveNow } from "../lib/devNow";
import { zv } from "../lib/validate";
import { syncProfileCards, toCardDto, todaysQueue } from "../services/review";

export const reviewRoutes = new Hono<AppEnv>()
  /** Due + new counts for each language the profile studies (Home screen). */
  .get("/summary", zv("query", summaryQuerySchema), async (c) => {
    const db = getDb(c.env);
    const { profile_id, tz } = c.req.valid("query");
    const now = resolveNow(c.env, c.req.header(DEV_NOW_HEADER));

    const profile = await syncProfileCards(db, c.env.DB, profile_id, now);
    if (!profile) return c.json({ error: "not_found" }, 404);

    const dayStart = localDayStart(now, tz);
    const langs = LEARN_LANGS.filter((l) => profile.study_langs.includes(l));
    const summary: ReviewSummary = await Promise.all(
      langs.map(async (lang) => {
        const q = await todaysQueue(db, {
          profileId: profile_id,
          lang,
          newLimit: profile.daily_new_limit,
          now,
          dayStart,
          isKid: profile.is_kid,
        });
        return { lang, due: q.due, new: q.new };
      }),
    );
    return c.json(summary);
  })

  /** Today's queue for one language. */
  .get("/queue", zv("query", queueQuerySchema), async (c) => {
    const db = getDb(c.env);
    const { profile_id, lang, tz } = c.req.valid("query");
    const now = resolveNow(c.env, c.req.header(DEV_NOW_HEADER));

    const profile = await syncProfileCards(db, c.env.DB, profile_id, now);
    if (!profile) return c.json({ error: "not_found" }, 404);
    if (!profile.study_langs.includes(lang)) return c.json({ items: [], now: now.getTime() });

    const q = await todaysQueue(db, {
      profileId: profile_id,
      lang,
      newLimit: profile.daily_new_limit,
      now,
      dayStart: localDayStart(now, tz),
      isKid: profile.is_kid,
    });
    return c.json({ items: q.items, now: now.getTime() });
  })

  /** Rates one card: the server schedules it (FSRS) and appends a review log. */
  .post("/answer", zv("json", answerRequestSchema), async (c) => {
    const db = getDb(c.env);
    const { profile_id, card_id, rating, duration_ms } = c.req.valid("json");
    const now = resolveNow(c.env, c.req.header(DEV_NOW_HEADER));

    // The language comes from the (root) word; it is stored on the log so stats survive card deletion.
    const row = await db
      .select({ card: cards, lang: words.lang })
      .from(cards)
      .innerJoin(words, eq(words.id, cards.word_id))
      .where(and(eq(cards.id, card_id), eq(cards.profile_id, profile_id)))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);

    const before: CardFields = { ...row.card, last_review: row.card.last_review };
    const { card: next, log } = applyReview(before, rating, now);

    // Card update + append-only log in one atomic batch.
    const [updated] = await db.batch([
      db.update(cards).set({ ...next, updated_at: now }).where(eq(cards.id, card_id)).returning(),
      db.insert(review_logs).values({ ...log, card_id, profile_id, duration_ms, lang: row.lang }),
    ]);
    return c.json({ card: toCardDto(updated[0]!) });
  });
