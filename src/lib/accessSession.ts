// What to do when a request to /api fails with a network error (fetch throws a TypeError).
//
// Two very different causes look the same to `fetch`:
//  - the Cloudflare Access session expired: Access answers with a redirect to its login page on
//    another domain, which a script is not allowed to follow (CORS), so fetch throws;
//  - the network is down or flaky.
// We tell them apart with one probe that does not follow redirects. Only an expired session
// reloads the page (a page load is allowed to follow the redirect to the login page).

export type SessionProbe = "expired" | "ok" | "offline";

/** GET /api/health without following redirects: an `opaqueredirect` answer means "log in again". */
export async function probeSession(fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<SessionProbe> {
  try {
    const res = await fetchFn("/api/health", { redirect: "manual", cache: "no-store" });
    // Browsers report a blocked-to-follow redirect as an opaque-redirect response (status 0).
    if (res.type === "opaqueredirect" || (res.status === 0 && res.type === "opaque")) return "expired";
    return "ok";
  } catch {
    return "offline";
  }
}

export type FailureOutcome = "reloading" | "offline" | "transient";

export type FailureDeps = {
  probe: () => Promise<SessionProbe>;
  reload: () => void;
  /** When the page was last reloaded for a login (epoch ms), to avoid a reload loop. */
  lastReloadAt: () => number | null;
  markReload: (at: number) => void;
  now: () => number;
};

/** A reload for login is not repeated within this time (a login page that fails again would loop). */
export const RELOAD_COOLDOWN_MS = 60_000;

/**
 * - session expired → reload once (the browser then lands on the Access login page) → "reloading";
 * - server unreachable → "offline": the app shows "Connection lost, try again", no reload;
 * - server reachable → "transient": the failure was a blip, the caller just reports its error.
 * An expired session inside the cool-down is treated as "offline" (a notice, never a loop).
 */
export async function handleFetchFailure(deps: FailureDeps): Promise<FailureOutcome> {
  const probe = await deps.probe();
  if (probe === "ok") return "transient";
  if (probe === "expired") {
    const last = deps.lastReloadAt();
    if (last === null || deps.now() - last > RELOAD_COOLDOWN_MS) {
      deps.markReload(deps.now());
      deps.reload();
      return "reloading";
    }
  }
  return "offline";
}

const RELOAD_KEY = "access_reload_at";

export const browserFailureDeps: FailureDeps = {
  probe: () => probeSession(),
  reload: () => window.location.reload(),
  lastReloadAt: () => {
    try {
      const v = Number(sessionStorage.getItem(RELOAD_KEY));
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  },
  markReload: (at) => {
    try {
      sessionStorage.setItem(RELOAD_KEY, String(at));
    } catch {
      // Without sessionStorage the cool-down cannot persist; a single reload still happens.
    }
  },
  now: () => Date.now(),
};
