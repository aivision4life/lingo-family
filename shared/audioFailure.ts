// Why audio could not be made (M7.13). Three failures used to look identical on screen — "Vẫn còn
// 3 mục chưa có audio. Hãy thử lại sau." — and they are not the same thing at all: waiting helps a
// busy service, waiting until tomorrow helps an exhausted quota, and waiting never helps a key the
// provider refuses. On a phone there are no developer tools to tell them apart.
import { z } from "zod";

export const audioFailureSchema = z.enum([
  /** Today's TTS allowance for this profile is used up; it comes back at UTC midnight. */
  "quota",
  /** The provider refused the request itself — a bad, expired or rotated key (HTTP 401/403).
   * Retrying changes nothing; the key has to be renewed. */
  "provider_rejected",
  /** The provider failed or could not be reached: a server error, a timeout, a network problem.
   * Worth trying again. */
  "provider_error",
  /** No Azure key/region configured in this environment at all. */
  "not_configured",
]);
export type AudioFailure = z.infer<typeof audioFailureSchema>;

/**
 * Which failure a whole run reports when several items failed for different reasons.
 *
 * Most actionable first: nothing can be done at all (not configured), then the one that needs a
 * new key, then "come back tomorrow", and only then the ordinary "try again" — a run that hit the
 * quota on one item and a timeout on another is a quota problem, because the quota is what the
 * next attempt will hit again.
 */
const ORDER: readonly AudioFailure[] = ["not_configured", "provider_rejected", "quota", "provider_error"];

export function worstFailure(reasons: readonly AudioFailure[]): AudioFailure | null {
  return ORDER.find((r) => reasons.includes(r)) ?? null;
}

/**
 * Reads the provider's own error text and says whether it refused us or merely failed.
 *
 * 401/403 is the provider saying the credentials are not acceptable — the exact case that left
 * every word added since 2026-11-05 silently without audio, with the screen saying only "try again
 * later" while trying again could never have worked.
 */
export function classifyTtsError(message: string): AudioFailure {
  return /\b(401|403)\b/.test(message) ? "provider_rejected" : "provider_error";
}
