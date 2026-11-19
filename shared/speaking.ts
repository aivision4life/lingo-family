// Speaking cards (M3.3, SPEC F4/F5): how a pronunciation score becomes an FSRS rating.
//
// The server is the only one that may state the rating (the M7.24 rule): the client sends the ids
// of the takes it recorded, the server reads back the scores **it** stored in `pron_attempts` and
// grades them here. Nothing in this file touches a database, so every boundary is unit tested.
import type { Grade } from "ts-fsrs";

/** Takes allowed on one speaking card. Every take is an uncacheable paid Azure call (SPEC F5). */
export const SPEAKING_MAX_TAKES = 3;

/**
 * Score → rating thresholds. Change them only here; `speakingRating` is the only place they are
 * compared, exactly as `pronBand` is for the colours (M3.2).
 *
 * They sit above the colour thresholds on purpose: green (`PRON_SCORE_GOOD` = 80) is "said well",
 * and only a clearly good take (90) earns the longest interval.
 */
export const SPEAKING_RATING_EASY = 90;
export const SPEAKING_RATING_GOOD = 80;
export const SPEAKING_RATING_HARD = 60;

/** One score → Again (1) / Hard (2) / Good (3) / Easy (4). Anything that is not a number is Again. */
export function speakingRating(score: number): Grade {
  if (!Number.isFinite(score)) return 1;
  if (score >= SPEAKING_RATING_EASY) return 4;
  if (score >= SPEAKING_RATING_GOOD) return 3;
  if (score >= SPEAKING_RATING_HARD) return 2;
  return 1;
}

/**
 * The rating for a whole card: the **best** take counts, because the learner was practising and the
 * last word they said is the one they learned. `null` = no take could be scored (nothing heard, a
 * network or Azure failure), and a card with no score at all is not reviewed at all: no rating is
 * invented, least of all Again (M3.3).
 */
export function speakingRatingFromScores(scores: readonly number[]): Grade | null {
  const usable = scores.filter((s) => Number.isFinite(s));
  return usable.length === 0 ? null : speakingRating(Math.max(...usable));
}
