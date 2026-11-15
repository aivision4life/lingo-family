/**
 * The one definition of "đã làm" (M7.27) — the question side of SPEC F12's rule that practice
 * across every paper only ever re-serves questions this profile has already answered.
 *
 * A question counts as answered when **either** screen has taken an answer for it:
 *  - practice: a `topik_attempts` row (any `scheduled` value — a "luyện lại" answer still means the
 *    learner has seen the question, which is the whole point here);
 *  - a mock test: a `topik_test_items` row of this profile's own sitting with a `selected_option`.
 *    `selected_option IS NULL` is a position the sitting never got to, in a tape that may have
 *    stopped at question 3 — counting those would burn questions nobody ever saw.
 *
 * One query, one place: the mixed-paper draw (SPEC F12 stage 3) must read the same definition, and
 * a second copy of it would be a second answer to "what have I done" the moment either changed.
 * The rule that turns this set into what a session may serve is `shared/topikAnswered.ts`.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { TopikSection } from "../../shared/enums";
import { topik_attempts, topik_cards, topik_questions, topik_test_items, topik_tests } from "../../db/schema";
import { MASTERED_CARD_STATE } from "../../shared/topikMastery";
import type { getDb } from "../env";

/**
 * Every question id of `section` this profile has answered, from either screen.
 *
 * Deliberately **not** parameterised by a list of question ids: a block can hold hundreds of them,
 * and D1 binds at most 100 parameters per statement, so asking "which of these have I done" would
 * be a chunked read that grows with the bank. This is two fixed-size statements whatever happens,
 * and a family's history is small enough to pass through memory.
 */
export async function answeredQuestionIds(
  db: ReturnType<typeof getDb>,
  profileId: string,
  section: TopikSection,
): Promise<Set<string>> {
  const [practice, sittings] = await Promise.all([
    db
      .select({ question_id: topik_attempts.question_id })
      .from(topik_attempts)
      .where(and(eq(topik_attempts.profile_id, profileId), eq(topik_attempts.section, section))),
    db
      .select({ question_id: topik_test_items.question_id })
      .from(topik_test_items)
      .innerJoin(topik_tests, eq(topik_tests.id, topik_test_items.test_id))
      .where(
        and(
          eq(topik_tests.profile_id, profileId),
          eq(topik_tests.section, section),
          isNotNull(topik_test_items.selected_option),
        ),
      ),
  ]);
  const ids = new Set<string>();
  // `question_id` is nullable in both tables (deleting a question keeps the history, M6.4).
  for (const row of [...practice, ...sittings]) if (row.question_id) ids.add(row.question_id);
  return ids;
}

/**
 * Every question id of `section` this profile has **mastered** — the query side of the one
 * definition in `shared/topikMastery.ts`, which is what the block picker's bar already shows.
 *
 * Joined to the question table rather than filtered by a list of ids, for the same reason as
 * above: one fixed-size statement whatever the bank grows to.
 */
export async function masteredQuestionIds(
  db: ReturnType<typeof getDb>,
  profileId: string,
  section: TopikSection,
): Promise<Set<string>> {
  const rows = await db
    .select({ question_id: topik_cards.question_id })
    .from(topik_cards)
    .innerJoin(topik_questions, eq(topik_questions.id, topik_cards.question_id))
    .where(
      and(
        eq(topik_cards.profile_id, profileId),
        eq(topik_questions.section, section),
        eq(topik_cards.state, MASTERED_CARD_STATE),
      ),
    );
  return new Set(rows.map((r) => r.question_id));
}
