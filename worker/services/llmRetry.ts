// Retry + fallback around single LLM attempts (provider-independent, unit-tested with a mock fetch).
// Transient failures (500, network errors, timeouts) are retried with exponential backoff and
// jitter; then the fallback model gets one attempt. Out of quota (429) and out of capacity (503)
// are never retried: they go straight to the fallback and the primary is left alone for a while.
// Other HTTP errors fail at once.

/** One failed attempt. `retryable` = worth waiting and trying again. */
export class AttemptError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  /** From a Retry-After header, when the provider sent one. */
  readonly retryAfterMs: number | null;
  constructor(message: string, status: number | null, retryable: boolean, retryAfterMs: number | null = null) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export const RETRYABLE_STATUS = new Set([429, 500, 503]);

/**
 * Out of quota (Google: RESOURCE_EXHAUSTED) or out of capacity (Google: UNAVAILABLE, "this model is
 * currently experiencing high demand"). Still "retryable" in the sense that the caller is told
 * "busy, try later" rather than "your request is wrong" — but waiting a few seconds and asking the
 * same model again cannot help, and that is what the retries used to do.
 *
 * Measured on production, 2026-11-15, one practice session: 31 calls to the primary model, 31
 * answers of 429, the very first one included. Every result therefore cost four useless calls to
 * the primary and ~13 s of backoff before the fallback was even asked; a question that needed its
 * vocabulary and then its explanation took 27-33 s, and the Worker cancels background work at 30.
 * Since 2026-11-01 the fallback had answered 326 of 330 cached results, and only 21 % of the
 * explanation attempts made in a session produced one.
 *
 * Measured again on production, 2026-11-19: the primary model had produced 1 of the 256 cached
 * results since 2026-11-15, and a single hand-made call to it answered 503 UNAVAILABLE, not 429.
 * 503 was still "retry three times" here, so every generation paid ~13 s of backoff before the
 * fallback was asked — and the Worker cancels background work at 30 s. Both statuses now mean the
 * same thing: this model has nothing for us right now, go elsewhere and leave it alone for a while.
 */
export const EXHAUSTED_STATUS = new Set([429, 503]);

/**
 * After a 429 or a 503 the primary model is not asked again for this long (same idea as M2.9's
 * `isProviderExhausted` for Workers AI). Per isolate and not durable, which is enough: the
 * provider's own answer stays the source of truth, this only stops paying for the same "no".
 * Only applies when there is a fallback to go to; without one the primary is always asked.
 */
export const MODEL_EXHAUSTED_MS = 10 * 60_000;
const exhaustedUntil = new Map<string, number>();
export const isModelExhausted = (model: string, now = Date.now()) => now < (exhaustedUntil.get(model) ?? 0);
export const markModelExhausted = (model: string, now = Date.now()) => void exhaustedUntil.set(model, now + MODEL_EXHAUSTED_MS);
/** For tests: the flag lives at module scope. */
export const resetModelExhausted = () => exhaustedUntil.clear();
/** Base waits before retry 1, 2, 3 (± 25 % jitter). */
export const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];
/** Gemini can take 30s+ under load; waiting costs no Worker CPU time. */
export const ATTEMPT_TIMEOUT_MS = 45_000;
/** Whole call (retries + fallback); the browser is waiting for the answer. */
export const TOTAL_BUDGET_MS = 100_000;
const MAX_RETRY_AFTER_MS = 30_000;

export type RetryOptions = {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  delays?: number[];
};

/** Runs one attempt against `model` with a timeout in ms; returns the answer text. */
export type Attempt = (model: string, timeoutMs: number) => Promise<string>;

export type RetryOutcome = { ok: true; text: string; model: string } | { ok: false; error: AttemptError };

/** Parses a Retry-After header (seconds or HTTP date) into ms. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export async function runWithRetry(primary: string, fallback: string | null, attempt: Attempt, opts: RetryOptions = {}): Promise<RetryOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const deadline = now() + TOTAL_BUDGET_MS;
  const timeout = () => Math.min(ATTEMPT_TIMEOUT_MS, deadline - now());

  const once = async (model: string): Promise<RetryOutcome> => {
    try {
      return { ok: true, text: await attempt(model, timeout()), model };
    } catch (e) {
      if (e instanceof AttemptError) return { ok: false, error: e };
      throw e;
    }
  };

  // 429 / 503: no point retrying the same model. Other retryable failures (500, network, timeout)
  // are transient in a way a short wait can fix, so they keep their retries.
  const isExhausted = (r: RetryOutcome) => !r.ok && r.error.status !== null && EXHAUSTED_STATUS.has(r.error.status);

  // null = the primary was not asked at all: it said "no" (429/503) a moment ago.
  let result: RetryOutcome | null = null;
  if (!(fallback && isModelExhausted(primary, now()))) {
    result = await once(primary);
    for (const base of delays) {
      if (result.ok || !result.error.retryable || isExhausted(result)) break;
      const jittered = base * (0.75 + 0.5 * random());
      const hinted = Math.min(result.error.retryAfterMs ?? 0, MAX_RETRY_AFTER_MS);
      const wait = Math.round(Math.max(jittered, hinted));
      if (wait >= deadline - now()) break;
      await sleep(wait);
      result = await once(primary);
    }
    if (result.ok) return result;
    if (isExhausted(result)) markModelExhausted(primary, now());
  }

  // The fallback gets one try when the primary is overloaded, out of quota/capacity or skipped (or the
  // model id is unknown).
  if (fallback && (result === null || result.error.retryable || result.error.status === 404) && deadline - now() > 0) {
    const second = await once(fallback);
    if (second.ok) return second;
    // Report the fallback's error when it is more specific than "busy", or when it is the only one.
    if (!second.error.retryable || result === null) return second;
  }
  return result ?? { ok: false, error: new AttemptError(`No attempt was made (${primary} is out of quota)`, null, true) };
}
