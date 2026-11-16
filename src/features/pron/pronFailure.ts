// What went wrong with one take, as one of a handful of cases the learner can act on (M3.2).
// Pure, so every mapping is tested: the screen only picks the message for the case it is given.
import { PRON_ERRORS } from "@shared/pron";
import { ApiError } from "@/lib/api";

/** Each value is also the i18n key under `pron.failure.*`. */
export type PronFailure =
  /** The browser refused the microphone (never asked, or blocked for the site). */
  | "micDenied"
  /** There is no microphone, or this browser cannot record. */
  | "micMissing"
  /** Azure heard no speech: the take was silence. The quota unit is spent all the same. */
  | "noSpeech"
  /** No scoring left today (profile or family). */
  | "quota"
  /** The recording itself was not usable (too short, wrong format). */
  | "badAudio"
  /** Scoring is not configured on this deployment. */
  | "unavailable"
  /** Everything else: no network, a server error, an answer we could not read. */
  | "network";

const MIC: Record<string, PronFailure> = {
  NotAllowedError: "micDenied",
  SecurityError: "micDenied",
  PermissionDeniedError: "micDenied",
  NotFoundError: "micMissing",
  NotSupportedError: "micMissing",
  OverconstrainedError: "micMissing",
};

const API: Record<string, PronFailure> = {
  [PRON_ERRORS.quotaExceeded]: "quota",
  [PRON_ERRORS.noResult]: "noSpeech",
  [PRON_ERRORS.invalidAudio]: "badAudio",
  [PRON_ERRORS.unavailable]: "unavailable",
};

/**
 * Anything thrown while recording or scoring → the one case to tell the learner about.
 *
 * A microphone the browser refused and a server that says "no speech heard" are the two the user
 * can do something about, so they must never collapse into a generic error; everything left over
 * (including Azure failing, which costs the learner nothing) becomes `network`.
 */
export function pronFailure(e: unknown): PronFailure {
  if (e instanceof ApiError) return API[e.code] ?? "network";
  const name = e instanceof Error ? e.name : "";
  return MIC[name] ?? "network";
}
