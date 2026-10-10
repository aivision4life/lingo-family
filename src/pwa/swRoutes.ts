// Request classification and cache limits for the service worker (src/sw.ts). Pure functions,
// shared with the app and unit tested; no browser or Workbox imports.

/** Media files (images + audio) are content-addressed: a key's bytes never change. */
export const MEDIA_CACHE = "media-v1";
export const MEDIA_MAX_ENTRIES = 800;
export const MEDIA_MAX_AGE_SECONDS = 60 * 24 * 60 * 60; // 60 days

export const FONT_CACHE = "fonts-v1";
export const FONT_MAX_ENTRIES = 300;
export const FONT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Slow networks: after this the precached app shell answers a page request. */
export const NAVIGATION_TIMEOUT_SECONDS = 4;

type Req = { url: URL; origin: string };

export const isMediaRequest = ({ url, origin }: Req) => url.origin === origin && url.pathname.startsWith("/api/media/");

/** Every other /api request: never cached (data, auth, quota counters). */
export const isApiRequest = ({ url, origin }: Req) => url.origin === origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/media/");

/**
 * Hashed font files from the build (Noto Sans KR comes in ~500 unicode-range pieces, so they are
 * cached when first used instead of precached).
 */
export const isFontRequest = ({ url, origin }: Req) => url.origin === origin && /^\/assets\/.+\.woff2?$/.test(url.pathname);

/** A page load (address bar, link, installed-app launch), as opposed to a fetch or an image. */
export const isNavigationRequest = (request: { mode: string }, url: URL) => request.mode === "navigate" && !url.pathname.startsWith("/api/");

/** Only a plain 200 may be stored: never a redirect, an Access login page, a 206 or an error. */
export const isCacheableStatus = (status: number) => status === 200;
