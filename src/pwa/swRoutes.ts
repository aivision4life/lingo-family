// Request classification and cache limits for the service worker (src/sw.ts). Pure functions,
// shared with the app and unit tested; no browser or Workbox imports.

/** Media files (images + audio) are content-addressed: a key's bytes never change. */
export const MEDIA_CACHE = "media-v1";

/**
 * The spoken files live in their own cache, apart from the ranged one.
 *
 * Not tidiness: `media-v1` may hold entries the old ranged route wrote for these same URLs, and a
 * cache-first route with a content-addressed key would hand such an entry back for sixty days —
 * the key never changes, so a bad copy could never be outgrown. A new name starts empty, and the
 * worst that costs is one download of a few tens of kilobytes per file.
 */
export const AUDIO_CACHE = "audio-v1";
export const MEDIA_MAX_ENTRIES = 800;
export const MEDIA_MAX_AGE_SECONDS = 60 * 24 * 60 * 60; // 60 days

/**
 * The app shell: the one file the app cannot start without, plus its icons. Kept in its own cache
 * and refetched on every install, so an update always has a shell to fall back on offline.
 */
export const SHELL_CACHE = "shell-v1";
/** Hashed build output (CSS/JS). The name contains a content hash, so an entry never goes stale. */
export const ASSET_CACHE = "assets-v1";
export const ASSET_MAX_ENTRIES = 40;

export const FONT_CACHE = "fonts-v1";
export const FONT_MAX_ENTRIES = 300;
export const FONT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * How long a page request may take before the precached app shell answers instead. Deliberately
 * long: serving the shell from the cache is how a stale deploy's HTML comes back, so it must be a
 * last resort for a connection that hangs, not something a slow phone network triggers routinely.
 * A device that is actually offline does not wait at all (`shouldSkipNetwork`).
 */
export const NAVIGATION_TIMEOUT_SECONDS = 15;

/**
 * Whether a page request should skip the network and use the precached shell straight away. Only
 * when the device reports itself offline: while it is online the network is the only source of
 * `index.html`, so a new deploy can never be masked by the previous one's cached shell.
 */
export const shouldSkipNetwork = (online: boolean) => !online;

type Req = { url: URL; origin: string };

export const isMediaRequest = ({ url, origin }: Req) => url.origin === origin && url.pathname.startsWith("/api/media/");

/**
 * Media that is small enough to be worth keeping, and serving, in one piece: the spoken files the
 * podcast is made of (`/api/media/audio/...`), tens of kilobytes each.
 *
 * `<audio>` asks for byte ranges, always on iOS, and a ranged request that misses the cache is
 * answered straight from the network as a 206 — a stream that can be cut short without the element
 * ever seeing an error. It then plays what arrived and waits for the rest for ever: the podcast
 * read one option of four and went silent. For these files the worker fetches and caches the whole
 * file instead, and answers from that.
 *
 * A TOPIK paper's own recording (`/api/media/topik/audio/...`) is ~30 MB and is played in
 * thirty-second slices, so it keeps the ranged path: whole-file is for what is small.
 */
export const isWholeFileMedia = ({ url, origin }: Req) => url.origin === origin && url.pathname.startsWith("/api/media/audio/");

/** Every other /api request: never cached (data, auth, quota counters). */
export const isApiRequest = ({ url, origin }: Req) => url.origin === origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/media/");

/**
 * Hashed font files from the build (Noto Sans KR comes in ~500 unicode-range pieces, so they are
 * cached when first used instead of precached).
 */
export const isFontRequest = ({ url, origin }: Req) => url.origin === origin && /^\/assets\/.+\.woff2?$/.test(url.pathname);

/**
 * Files the worker keeps a copy of at install time: the shell itself and the icons an installed app
 * shows while it starts. Deliberately tiny — everything else is cached when it is first used.
 */
export const isShellPath = (pathname: string) =>
  pathname === "/" || pathname === "/index.html" || pathname === "/manifest.webmanifest" || pathname === "/favicon.svg" || pathname.startsWith("/icons/");

/**
 * A hashed build file (CSS/JS) that may be cached forever: its name changes whenever its content
 * does, so a cached entry can never be the wrong version. Fonts have their own cache and limit.
 */
export const isHashedAsset = ({ url, origin }: Req) =>
  url.origin === origin && /^\/assets\/.+\.(css|js|map)$/.test(url.pathname);

/** A page load (address bar, link, installed-app launch), as opposed to a fetch or an image. */
export const isNavigationRequest = (request: { mode: string }, url: URL) => request.mode === "navigate" && !url.pathname.startsWith("/api/");

/** Only a plain 200 may be stored: never a redirect, an Access login page, a 206 or an error. */
export const isCacheableStatus = (status: number) => status === 200;
