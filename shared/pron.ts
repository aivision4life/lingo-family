// Pronunciation scoring (SPEC F5, M3): contract shared by the Worker and the app.
import { z } from "zod";
import { learnLangSchema } from "./enums";

/**
 * Daily scoring quota (`usage_daily` service `pron`), two tiers like images: per profile AND for
 * the whole family, taken in one atomic statement (`consumeTieredQuota`). Change them only here.
 *
 * The numbers come from Azure's free tier, not from how much practice is "enough": F0 gives 5 hours
 * of audio a month for all speech-to-text (~18,000 s), no take can be cached, and a take is at most
 * `PRON_MAX_SECONDS` (shared/wav.ts). 60 takes x 8 s x 31 days = 14,880 s, inside the allowance
 * even if the family cap is reached every single day.
 */
export const PRON_DAILY_QUOTA_ADULT = 25;
/** Kid profiles may practise speaking (it is study, not an "AI feature"), on a smaller allowance. */
export const PRON_DAILY_QUOTA_KID = 15;
export const PRON_FAMILY_DAILY_CAP = 60;
export const pronDailyQuota = (isKid: boolean) => (isKid ? PRON_DAILY_QUOTA_KID : PRON_DAILY_QUOTA_ADULT);
/**
 * Colour thresholds for a score (SPEC F5): green at or above `PRON_SCORE_GOOD`, yellow down to
 * `PRON_SCORE_FAIR`, red below it. Here only — never a number written into a component.
 */
export const PRON_SCORE_GOOD = 80;
export const PRON_SCORE_FAIR = 60;

/** Longest reference text sent to Azure: a word, a phrase or one example sentence. */
export const PRON_REFERENCE_MAX = 200;

export const PRON_ERRORS = {
  /** The body is not a 16 kHz mono 16-bit PCM WAV of an acceptable length. */
  invalidAudio: "invalid_audio",
  quotaExceeded: "quota_exceeded",
  /** Azure Speech is not configured on this deployment. */
  unavailable: "pron_unavailable",
  /**
   * Azure could not be reached, or answered a body we cannot read: nothing was processed for us, so
   * the quota unit was given back.
   */
  failed: "pron_failed",
  /**
   * Azure answered 200 but heard no speech (`NoMatch`, `InitialSilenceTimeout`): the microphone was
   * muted, or the take is silence. No score exists, but Azure listened to those seconds, so the
   * quota unit **stays spent** (M3.2) — refunding it would let repeated silence call Azure without
   * any limit, and it is the only fence this uncacheable call has.
   */
  noResult: "pron_no_result",
} as const;

/**
 * M3.1 scoring (`POST /api/pron/score`, body = WAV, the parameters in the query).
 * Exactly one of `word_id` / `phrase_id` / `example_id` says what is being practised — the same
 * three columns `pron_attempts` has, and the row is worthless without one of them (F5: practice
 * targets a word, a phrase or an example sentence).
 */
export const pronScoreQuerySchema = z
  .object({
    profile_id: z.string().min(1),
    lang: learnLangSchema,
    reference_text: z.string().trim().min(1).max(PRON_REFERENCE_MAX),
    word_id: z.string().min(1).optional(),
    phrase_id: z.string().min(1).optional(),
    example_id: z.string().min(1).optional(),
  })
  .refine((q) => [q.word_id, q.phrase_id, q.example_id].filter(Boolean).length === 1, {
    message: "exactly one of word_id, phrase_id, example_id",
  });
export type PronScoreQuery = z.infer<typeof pronScoreQuerySchema>;

const pronSyllableSchema = z.object({ text: z.string(), score: z.number().nullable() });
const pronWordSchema = z.object({
  text: z.string(),
  score: z.number().nullable(),
  error: z.string(),
  syllables: z.array(pronSyllableSchema).optional(),
});
/** `pron_attempts.details_json`, as the app reads it back. Mirrors `PronDetails` (shared/pronScore.ts). */
export const pronDetailsSchema = z.object({
  v: z.literal(1),
  locale: z.string(),
  words: z.array(pronWordSchema),
  snr: z.number().optional(),
});

export const pronScoreResponseSchema = z.object({
  /** The `pron_attempts` row that was written; history (M3.2) is read back by it. */
  attempt_id: z.string(),
  pron_score: z.number(),
  accuracy: z.number(),
  fluency: z.number(),
  completeness: z.number(),
  /** Length of the take as the Worker measured it, also stored on the row. */
  duration_ms: z.number(),
  details: pronDetailsSchema,
});
export type PronScoreResponse = z.infer<typeof pronScoreResponseSchema>;
