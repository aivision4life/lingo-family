// Speaking cards (M3.3): the server's half of "only the server may say what a turn was worth"
// (the M7.24 rule). The client sends the ids of the takes it recorded on the card; everything that
// decides the rating is read back here, out of the rows this same Worker wrote.
import { and, eq, gte, inArray } from "drizzle-orm";
import type { Grade } from "ts-fsrs";
import { speakingRatingFromScores } from "../../shared/speaking";
import { cards, pron_attempts } from "../../db/schema";
import type { getDb } from "../env";

/**
 * How far back a take may have been recorded to still belong to "this turn on this card". Long
 * enough for a slow session on a phone, short enough that yesterday's good take cannot be sent
 * again to buy an Easy. A take recorded before the card's last review is rejected outright.
 */
export const SPEAKING_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

type Card = typeof cards.$inferSelect;

/**
 * The rating for one speaking card, or `null` when no take of this profile, on this card's own
 * item, inside the window, could be scored — and then the card is not reviewed at all: no log, no
 * FSRS change, and above all no Again (M3.3).
 *
 * `attempt_ids` are at most SPEAKING_MAX_TAKES (zod), so the `IN (...)` list can never approach
 * D1's 100-parameter limit.
 */
export async function speakingRatingForCard(
  db: ReturnType<typeof getDb>,
  card: Card,
  attemptIds: string[],
  now: Date,
): Promise<Grade | null> {
  if (attemptIds.length === 0) return null;
  const since = new Date(Math.max(now.getTime() - SPEAKING_ATTEMPT_WINDOW_MS, card.last_review?.getTime() ?? 0));
  const rows = await db
    .select({ score: pron_attempts.pron_score, word_id: pron_attempts.word_id, phrase_id: pron_attempts.phrase_id })
    .from(pron_attempts)
    .where(
      and(
        inArray(pron_attempts.id, attemptIds),
        // The take must be this profile's own, and the row must be about the item this card is
        // about: a phrase card is answered by a take of that phrase, a word card by a take of the
        // word itself (an example sentence of it is a different exercise and does not count).
        eq(pron_attempts.profile_id, card.profile_id),
        gte(pron_attempts.created_at, since),
      ),
    );
  const onThisItem = rows.filter((r) =>
    card.phrase_id ? r.phrase_id === card.phrase_id : r.phrase_id === null && r.word_id === card.word_id,
  );
  return speakingRatingFromScores(onThisItem.map((r) => r.score));
}
