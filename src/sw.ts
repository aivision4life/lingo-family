/// <reference lib="webworker" />
// Service worker (production build only; vite-plugin-pwa `injectManifest`). A service worker is a
// script the browser runs in the background for this site: it can answer requests from a cache.
//
//  - app shell (HTML/JS/CSS/icons): precached, so the app opens without a network;
//  - /api/media/*  (images + audio, content-addressed, immutable): cache-first, limited, 60 days;
//  - other /api/*  : never cached (network only);
//  - page loads    : network first. A redirect (e.g. Cloudflare Access login after the session
//                    expired) is passed to the browser untouched and never stored, so the app can
//                    still be sent to the login page. Only when the network fails (offline, or
//                    slower than 4 s) the precached app shell answers.
import { clientsClaim } from "workbox-core";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { RangeRequestsPlugin } from "workbox-range-requests";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkOnly } from "workbox-strategies";
import {
  FONT_CACHE,
  FONT_MAX_AGE_SECONDS,
  FONT_MAX_ENTRIES,
  isApiRequest,
  isFontRequest,
  isMediaRequest,
  isNavigationRequest,
  MEDIA_CACHE,
  MEDIA_MAX_AGE_SECONDS,
  MEDIA_MAX_ENTRIES,
  NAVIGATION_TIMEOUT_SECONDS,
} from "./pwa/swRoutes";

declare const self: ServiceWorkerGlobalScope;

// A new version waits until the user taps "Reload" in the app (registerType "prompt").
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const origin = self.location.origin;
const only200 = () => new CacheableResponsePlugin({ statuses: [200] });

// Media: cache-first. `RangeRequestsPlugin` lets <audio> (which asks for byte ranges, always on
// iOS) play files that are cached as whole 200 responses.
const media = new CacheFirst({
  cacheName: MEDIA_CACHE,
  plugins: [
    only200(),
    new RangeRequestsPlugin(),
    new ExpirationPlugin({ maxEntries: MEDIA_MAX_ENTRIES, maxAgeSeconds: MEDIA_MAX_AGE_SECONDS, purgeOnQuotaError: true }),
  ],
});
registerRoute(
  ({ url }) => isMediaRequest({ url, origin }),
  async (ctx) => {
    const response = await media.handle(ctx);
    // A cache miss for a Range request returns a partial (206) response that is not stored;
    // fetch the whole file in the background so the next play is served from the cache.
    if (response.status === 206 && ctx.event instanceof ExtendableEvent) {
      ctx.event.waitUntil(media.handle({ ...ctx, request: new Request(ctx.url.href, { credentials: "same-origin" }) }).catch(() => undefined));
    }
    return response;
  },
);

// Fonts: ~500 hashed Noto Sans KR pieces; keep the ones that were used.
registerRoute(
  ({ url }) => isFontRequest({ url, origin }),
  new CacheFirst({
    cacheName: FONT_CACHE,
    plugins: [only200(), new ExpirationPlugin({ maxEntries: FONT_MAX_ENTRIES, maxAgeSeconds: FONT_MAX_AGE_SECONDS, purgeOnQuotaError: true })],
  }),
);

// Everything else under /api: explicitly network only.
registerRoute(({ url }) => isApiRequest({ url, origin }), new NetworkOnly());

// Page loads: network first, precached shell only when the network fails.
const network = new NetworkOnly({ networkTimeoutSeconds: NAVIGATION_TIMEOUT_SECONDS });
registerRoute(
  ({ request, url }) => isNavigationRequest(request, url),
  async (ctx) => {
    try {
      return await network.handle(ctx);
    } catch {
      return (await matchPrecache("/index.html")) ?? Response.error();
    }
  },
);
