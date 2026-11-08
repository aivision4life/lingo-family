// Practice-session progress kept on the device (M7.19): which group the learner is on, every
// answer already given, and — the part that cannot be rebuilt from anywhere else — the list of
// words marked "add to library" while answering.
//
// **On the device, not the server.** A session lasts a few minutes on one phone, so an extra
// network write per answer buys nothing. The answers themselves are in `topik_attempts` /
// `topik_cards` the moment they are given; this record only redraws the screen, and restoring it
// never sends anything back (a restored state makes the question unanswerable again, so the same
// attempt can never be recorded twice).
//
// What it protects against: the phone dropping the tab while the app is in the background, a
// Cloudflare Access session expiring into a reload, a tab closed by accident.
import { z } from "zod";
import { topikSectionSchema, type TopikSection } from "@shared/enums";
import {
  topikAttemptResultSchema,
  topikPracticeQuestionSchema,
  topikSessionModeSchema,
  topikWordSourceSchema,
  type TopikPracticeQuestion,
  type TopikSessionMode,
} from "@shared/topik";
import { groupQuestions } from "./groups";
import type { MarkedTerm } from "./markedWords";
import type { SessionStates } from "./sessionState";

/** Older than this and the record is dropped: coming back the next day means a new session, not
 * the middle of yesterday's. */
export const SESSION_TTL_MS = 3 * 60 * 60 * 1000;

/** One slot per profile (there is only ever one practice session), so one profile can never see
 * another's progress, and opening a different block simply overwrites the old record. */
export const sessionKey = (profileId: string) => `topik_session_v1_${profileId}`;

const markedTermSchema = z.object({ lemma: z.string().min(1), gloss_vi: z.string(), source: topikWordSourceSchema });

/** Mirrors `QuestionState` in `sessionState.ts`; a stored record from an older build that no
 * longer parses is treated as absent. */
const questionStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answered"), selected: z.number().int(), result: topikAttemptResultSchema }),
  z.object({ kind: z.literal("skipped") }),
  z.object({ kind: z.literal("given_up") }),
]);

export const savedSessionSchema = z.object({
  v: z.literal(1),
  profile_id: z.string().min(1),
  section: topikSectionSchema,
  from: z.number().int(),
  to: z.number().int(),
  mode: topikSessionModeSchema,
  /**
   * The questions themselves, not just their ids. In `mode: "due"` a question that has just been
   * answered is no longer due, so the next fetch does **not** return it — with ids alone the dot
   * strip would shrink on a reload and the final tally would count 7 questions instead of 10.
   */
  questions: z.array(topikPracticeQuestionSchema).min(1),
  index: z.number().int().nonnegative(),
  states: z.record(z.string(), questionStateSchema),
  marked: z.array(markedTermSchema),
  saved_at: z.number().int(),
});

export type SavedSession = {
  v: 1;
  profile_id: string;
  section: TopikSection;
  from: number;
  to: number;
  mode: TopikSessionMode;
  questions: TopikPracticeQuestion[];
  index: number;
  states: SessionStates;
  marked: MarkedTerm[];
  saved_at: number;
};

/** What the screen the learner just opened is: a record for anything else must not be restored. */
export type SessionIdentity = { profileId: string; section: TopikSection; from: number; to: number; mode: TopikSessionMode };

/** Whether a question's stored state means it has been dealt with — and may therefore be missing
 * from a fresh fetch, because FSRS has pushed its due date out. */
const settled = (states: SessionStates, id: string) => states[id]?.kind === "answered" || states[id]?.kind === "given_up";

/** A stored blob, validated. `null` for absent, corrupted, or written by an older build. */
export function parseSaved(raw: string | null): SavedSession | null {
  if (!raw) return null;
  try {
    const parsed = savedSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as SavedSession) : null;
  } catch {
    return null;
  }
}

/**
 * The "still matching" rule (SPEC M7.19), pure so the decision is testable on its own.
 *
 * Three conditions, and anything else returns null — the record is then dropped whole and a new
 * session starts, rather than half of it being grafted onto a different set of questions:
 *
 * 1. Same profile, section, range and mode as the screen being opened.
 * 2. Younger than `SESSION_TTL_MS`.
 * 3. Every question **not** yet settled is still in what the server just served. An answered or
 *    given-up one is expected to be missing (it is no longer due); a skipped or untouched one
 *    disappearing means the block itself changed underneath — re-imported, deleted — and nothing
 *    about the old record can be trusted.
 */
export function restoreSession(
  saved: SavedSession | null,
  identity: SessionIdentity,
  fetchedIds: readonly string[],
  /** Defaulted here rather than at the call site so `react-hooks/purity` does not see a clock
   * read during render (same reason as `elapsedSince` in `TopikSession`); tests pass it. */
  now: number = Date.now(),
): SavedSession | null {
  if (!saved) return null;
  if (
    saved.profile_id !== identity.profileId ||
    saved.section !== identity.section ||
    saved.from !== identity.from ||
    saved.to !== identity.to ||
    saved.mode !== identity.mode
  ) {
    return null;
  }
  if (now - saved.saved_at > SESSION_TTL_MS) return null;
  const served = new Set(fetchedIds);
  const missing = saved.questions.filter((q) => !settled(saved.states, q.id) && !served.has(q.id));
  return missing.length === 0 ? saved : null;
}

export function readSession(profileId: string): SavedSession | null {
  try {
    return parseSaved(localStorage.getItem(sessionKey(profileId)));
  } catch {
    // Private mode, blocked storage: no saved progress, which is the pre-M7.19 behaviour.
    return null;
  }
}

/**
 * Writes the record, falling back to a smaller one if the quota refuses it.
 *
 * The questions are most of the bytes. A cut-down record that still restores the screen the
 * learner is on — and every word they marked — beats keeping nothing at all, so that is what the
 * second attempt writes. Both attempts failing is not an error: progress simply does not persist,
 * which is exactly how the app behaved before this existed.
 */
export function writeSession(record: SavedSession): void {
  const key = sessionKey(record.profile_id);
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(trimForQuota(record)));
    } catch {
      // Progress just will not persist. Everything on screen keeps working.
    }
  }
}

/**
 * The cut-down record: only the group the learner is on, which becomes group 0.
 *
 * Its tally then counts just those questions — the one visible cost, paid only on a device whose
 * storage is full. The marked words, the reason any of this exists, are kept in full.
 */
export function trimForQuota(record: SavedSession): SavedSession {
  // `index` counts groups, not questions (a listening pair is one screen), so the group has to be
  // looked up the same way the screen does.
  const groups = groupQuestions(record.questions);
  const current = groups[Math.min(record.index, groups.length - 1)];
  const keep = current ? record.questions.filter((q) => q.group_id === current.group_id) : [];
  return { ...record, index: 0, questions: keep.length > 0 ? keep : record.questions.slice(0, 1) };
}

export function clearSession(profileId: string): void {
  try {
    localStorage.removeItem(sessionKey(profileId));
  } catch {
    // Nothing to do: the record expires on its own after SESSION_TTL_MS.
  }
}
