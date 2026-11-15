/**
 * The one definition of "đã làm" (M7.27) — the question side of SPEC F12's rule that practice
 * across every paper only ever re-serves questions this profile has already answered, and since
 * M7.30 the source of "2/4" wherever a question's own history is shown.
 *
 * One answer is one row of:
 *  - practice: a `topik_attempts` row with an option actually chosen (any `scheduled` value — a
 *    "luyện lại" answer still means the learner has seen the question, which is the whole point
 *    here). A finished sitting writes one of these per position too (`gradeAndFinish`), which is
 *    why the sittings read below stops at the ones still open: counting a graded sitting from both
 *    tables would say "4 lần" for two. It writes them for the positions the tape ran past as well,
 *    with `selected_option = 0`, so that the schedule knows they were missed — and `0` is not an
 *    option a learner can pick (they are 1..4), which is exactly what tells the two apart here.
 *  - a sitting not graded yet (running, or abandoned): a `topik_test_items` row with a
 *    `selected_option`.
 *
 * Either way a position nobody answered does not count — a tape may have stopped at question 3, and
 * burning questions nobody ever saw is the mistake this whole rule exists to avoid.
 *
 * One query, one place: the mixed-paper draw (SPEC F12 stage 3), the practice screen's "2/4" and a
 * sitting's own indicator all read this, and a second copy of it would be a second answer to "what
 * have I done" the moment either changed. The rules applied to the result — what a session may
 * serve, and how a question stood at a given moment — are pure functions in
 * `shared/topikAnswered.ts`.
 */
import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import type { TopikSection } from "../../shared/enums";
import { topik_attempts, topik_cards, topik_questions, topik_test_items, topik_tests } from "../../db/schema";
import type { AnswerEvent } from "../../shared/topikAnswered";
import { MASTERED_CARD_STATE } from "../../shared/topikMastery";
import type { getDb } from "../env";

/** What to read answers for: a whole section (the draw, a sitting) or one question (its card). */
export type AnswerScope = { section: TopikSection } | { questionId: string };

/**
 * Every answer this profile has given, grouped by question id.
 *
 * Deliberately **not** parameterised by a list of question ids: a block can hold hundreds of them,
 * and D1 binds at most 100 parameters per statement, so asking "which of these have I done" would
 * be a chunked read that grows with the bank. This is two fixed-size statements whatever happens,
 * and a family's history is small enough to pass through memory.
 */
export async function answerEvents(
  db: ReturnType<typeof getDb>,
  profileId: string,
  scope: AnswerScope,
): Promise<Map<string, AnswerEvent[]>> {
  const bySection = "section" in scope;
  const [practice, sittings] = await Promise.all([
    db
      .select({
        question_id: topik_attempts.question_id,
        at: topik_attempts.answered_at,
        correct: topik_attempts.is_correct,
      })
      .from(topik_attempts)
      .where(
        and(
          eq(topik_attempts.profile_id, profileId),
          // Not a chosen option: a position a finished sitting ran past (see above).
          gt(topik_attempts.selected_option, 0),
          bySection ? eq(topik_attempts.section, scope.section) : eq(topik_attempts.question_id, scope.questionId),
        ),
      ),
    db
      .select({
        question_id: topik_test_items.question_id,
        at: topik_test_items.answered_at,
        started_at: topik_tests.started_at,
        selected_option: topik_test_items.selected_option,
        // An open sitting has not been graded, so what is right is read from the question itself —
        // the same comparison `gradeAndFinish` will make later.
        correct_option: topik_questions.correct_option,
        test_id: topik_tests.id,
      })
      .from(topik_test_items)
      .innerJoin(topik_tests, eq(topik_tests.id, topik_test_items.test_id))
      .innerJoin(topik_questions, eq(topik_questions.id, topik_test_items.question_id))
      .where(
        and(
          eq(topik_tests.profile_id, profileId),
          ne(topik_tests.status, "finished"),
          isNotNull(topik_test_items.selected_option),
          bySection ? eq(topik_tests.section, scope.section) : eq(topik_test_items.question_id, scope.questionId),
        ),
      ),
  ]);

  const byQuestion = new Map<string, AnswerEvent[]>();
  const add = (questionId: string | null, event: AnswerEvent) => {
    // `question_id` is nullable in both tables (deleting a question keeps the history, M6.4).
    if (!questionId) return;
    const list = byQuestion.get(questionId);
    if (list) list.push(event);
    else byQuestion.set(questionId, [event]);
  };
  for (const row of practice) add(row.question_id, { at: row.at.getTime(), correct: row.correct, test_id: null });
  for (const row of sittings) {
    add(row.question_id, {
      // An answer given before `answered_at` existed falls back to the sitting's own start.
      at: (row.at ?? row.started_at).getTime(),
      correct: row.selected_option === row.correct_option,
      test_id: row.test_id,
    });
  }
  for (const list of byQuestion.values()) list.sort((a, b) => a.at - b.at);
  return byQuestion;
}

/** Every question id of `section` this profile has answered — one event is enough. */
export async function answeredQuestionIds(
  db: ReturnType<typeof getDb>,
  profileId: string,
  section: TopikSection,
): Promise<Set<string>> {
  return new Set((await answerEvents(db, profileId, { section })).keys());
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
