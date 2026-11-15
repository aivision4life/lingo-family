/**
 * A dynamic `import()` that survives a deploy.
 *
 * Routes that are loaded on demand are fetched by file name, and that name holds the build's hash.
 * An installed PWA can keep a page open across a deploy: its JS is the old build's, so opening such
 * a route asks for a chunk whose name only existed in the old deploy. The service worker usually
 * still has it (`ASSET_CACHE` is cache-first and survives an update, and `warmAssets` put it there),
 * but not always — an eviction, a device that never warmed that chunk, or a cache that was cleared
 * leaves the request to go to the network, where Cloudflare serves only the current deploy's
 * assets. The import then rejects with "Failed to fetch dynamically imported module" and the route
 * renders nothing at all.
 *
 * One reload fixes it, because the reload fetches the new `index.html` with the new chunk names. So
 * that is what happens here, **once**: if the import fails again right after a reload, the error is
 * rethrown and the app can show it, rather than reloading forever.
 */

/** Marks that a reload has already been tried; per tab, so another tab's reload does not count. */
export const CHUNK_RELOAD_KEY = "lingo:chunk-reload";
/** A failure longer than this after a reload is a new problem, not the one the reload was for. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

/**
 * Whether this rejection is a chunk that could not be fetched, rather than an error thrown by the
 * module's own code while it was evaluated — reloading the page would not help with that one.
 *
 * The message is the only thing to go on and every engine words it differently, so all four known
 * wordings are listed (Chrome, Firefox, Safari, and the bare network failure a service worker
 * returns when it has no cached copy and no network).
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to fetch/i.test(message);
}

/**
 * Whether a reload is worth trying. `stored` is what the previous attempt wrote, if any.
 *
 * A missing or unreadable mark means nothing has been tried yet. A mark from the last minute means
 * the reload has just happened and did not help, so reloading again would loop.
 */
export function shouldReloadForChunk(stored: string | null, now: number): boolean {
  const at = Number(stored);
  if (!Number.isFinite(at) || at <= 0) return true;
  return now - at > CHUNK_RELOAD_WINDOW_MS;
}

/** sessionStorage throws in private mode and when storage is blocked; neither is worth an error. */
const readMark = (): string | null => {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_KEY);
  } catch {
    return null;
  }
};
const writeMark = (now: number) => {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    /* nothing to do: the reload still happens, it just cannot be remembered */
  }
};

/**
 * Wraps a route's `import()`. On a chunk that cannot be fetched it reloads the page once and never
 * resolves, so nothing renders an error screen in the moment before the reload takes effect.
 *
 * Offline is left alone: a reload cannot bring back a file that is neither cached nor reachable, and
 * it would throw away the page the learner is looking at.
 */
export async function importChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const online = typeof navigator === "undefined" || navigator.onLine;
    if (!online || !isChunkLoadError(error) || !shouldReloadForChunk(readMark(), Date.now())) throw error;
    writeMark(Date.now());
    window.location.reload();
    return new Promise<never>(() => {});
  }
}
