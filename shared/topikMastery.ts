/**
 * "Thuộc" (M6.11) — one definition for the whole app.
 *
 * The block picker's progress bar calls a question *mastered* when this profile's card for it has
 * reached ts-fsrs `Review`: answered once is merely *opened*, and a block where every question has
 * been answered but nothing is remembered is still work to do. The mixed draw (M7.28) ranks
 * candidates by the same rule, so the constant lives here rather than being spelled out twice —
 * the blocks aggregate binds it into its SQL and `masteredQuestionIds` filters on it.
 */
import { State } from "ts-fsrs";

/** The `topik_cards.state` value that means "đã thuộc". */
export const MASTERED_CARD_STATE: number = State.Review;

/** Whether a stored card state counts as mastered (no card at all is never mastered). */
export const isMasteredState = (state: number | null | undefined): boolean => state === MASTERED_CARD_STATE;
