// Retry + fallback around single LLM attempts (provider-independent, unit-tested with a mock fetch).
// Transient failures (429/500/503, network errors, timeouts) are retried with exponential backoff
// and jitter; then the fallback model gets one attempt. Other HTTP errors fail at once.

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

  let result = await once(primary);
  for (const base of delays) {
    if (result.ok || !result.error.retryable) break;
    const jittered = base * (0.75 + 0.5 * random());
    const hinted = Math.min(result.error.retryAfterMs ?? 0, MAX_RETRY_AFTER_MS);
    const wait = Math.round(Math.max(jittered, hinted));
    if (wait >= deadline - now()) break;
    await sleep(wait);
    result = await once(primary);
  }

  // The fallback gets one try when the primary is overloaded (or the model id is unknown).
  if (!result.ok && fallback && (result.error.retryable || result.error.status === 404) && deadline - now() > 0) {
    const second = await once(fallback);
    if (second.ok) return second;
    // Report the fallback's error only if it is more specific than "busy".
    if (!second.error.retryable) return second;
  }
  return result;
}
