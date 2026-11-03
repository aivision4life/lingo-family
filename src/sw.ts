/// <reference lib="webworker" />
// Service worker (production build only; vite-plugin-pwa `injectManifest`). A service worker is a
// script the browser runs in the background for this site: it can answer requests from a cache.
//
//  - app shell (index.html + icons): copied at install, so the app opens without a network;
//  - /assets/*     (hashed CSS/JS): cached when first used, kept (the name holds the hash);
//  - /api/media/*  (images + audio, content-addressed, immutable): cache-first, limited, 60 days;
//  - other /api/*  : never cached (network only);
//  - page loads    : network first (the shell is never served from the cache while the device is
//                    online and answering). A redirect (e.g. Cloudflare Access login after the session
//                    expired) is passed to the browser untouched and never stored, so the app can
//                    still be sent to the login page. The precached shell answers only when the
//                    device is offline, or the request fails or hangs.
import { clientsClaim } from "workbox-core";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches } from "workbox-precaching";
import { RangeRequestsPlugin } from "workbox-range-requests";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkOnly } from "workbox-strategies";
import {
  ASSET_CACHE,
  ASSET_MAX_ENTRIES,
  FONT_CACHE,
  FONT_MAX_AGE_SECONDS,
  FONT_MAX_ENTRIES,
  isApiRequest,
  isHashedAsset,
  isFontRequest,
  isMediaRequest,
  isNavigationRequest,
  isShellPath,
  MEDIA_CACHE,
  MEDIA_MAX_AGE_SECONDS,
  MEDIA_MAX_ENTRIES,
  NAVIGATION_TIMEOUT_SECONDS,
  SHELL_CACHE,
  shouldSkipNetwork,
} from "./pwa/swRoutes";

declare const self: ServiceWorkerGlobalScope;

/**
 * Take over as soon as this worker is installed, instead of sitting in `waiting` until a client
 * asks for it.
 *
 * The previous version only called `skipWaiting()` from the message below, which the app sends when
 * the user taps "Reload" in `UpdateBanner`. That button is rendered by the app itself, so a build
 * that fails to mount (a shell whose HTML and JS came from different deploys, for example) leaves
 * nothing that can send the message: the old worker stays active, keeps serving its own precached
 * shell, and the only escape is developer tools — which a phone does not have. Activation must
 * never depend on the broken app being able to draw a button.
 *
 * `clientsClaim()` then points pages that are already open at this worker, so the next request they
 * make is served from the new precache rather than the previous one.
 */
self.addEventListener("install", () => void self.skipWaiting());
// Kept for `updateServiceWorker()` from an older client that is still running the previous bundle.
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});
clientsClaim();

cleanupOutdatedCaches();

const origin = self.location.origin;

/** Paths from the build's own manifest (`injectManifest` fills `__WB_MANIFEST`). */
const buildPaths = () => self.__WB_MANIFEST.map((e) => new URL(typeof e === "string" ? e : e.url, origin).pathname);

/**
 * Copies the shell — `index.html` and the icons, nothing else — into the cache **one file at a
 * time, never rejecting**.
 *
 * This is the whole lesson of M7.4. The previous version handed the build's entire manifest to
 * Workbox's `precacheAndRoute`, which fetches every entry and fails the *install* if a single one
 * of them fails. Cloudflare answered one 500 for one stylesheet on one phone, and that was enough:
 * the new worker never installed, the old one kept serving the previous build, and a phone has no
 * developer tools to undo it with. A file that cannot be fetched may cost one ugly page load; it
 * may never cost the ability to move to a new version.
 *
 * Nothing here is permanent either: `cache: "reload"` refetches on every install, and a file that
 * failed is fetched again the next time it is asked for.
 */
async function cacheShell(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  const store = async (path: string, from = path) => {
    const response = await fetch(new Request(from, { cache: "reload", credentials: "same-origin" }));
    if (response.status === 200) await cache.put(path, response);
  };
  // The HTML is fetched from "/" and stored as "/index.html": the asset layer redirects
  // /index.html to /, and a redirected response is a needless thing to keep in the shell cache.
  const icons = buildPaths().filter((p) => isShellPath(p) && p !== "/" && p !== "/index.html");
  await Promise.allSettled([store("/index.html", "/"), ...icons.map((p) => store(p))]);
}

/** Fills the asset cache with this build's CSS/JS, best effort, so offline works after an update. */
async function warmAssets(): Promise<void> {
  const cache = await caches.open(ASSET_CACHE);
  const paths = buildPaths().filter((p) => isHashedAsset({ url: new URL(p, origin), origin }));
  await Promise.allSettled(
    paths.map(async (path) => {
      if (await cache.match(path)) return;
      const response = await fetch(new Request(path, { credentials: "same-origin" }));
      if (response.status === 200) await cache.put(path, response);
    }),
  );
}

/** The caches this worker uses; anything else was left by an older version. */
const OWN_CACHES = [SHELL_CACHE, ASSET_CACHE, MEDIA_CACHE, FONT_CACHE];

// Both handlers swallow everything. `catch` as well as `allSettled`: even failing to open a cache
// (private mode, no quota left) must not reject, or the install fails and the old worker stays.
self.addEventListener("install", (event) => void event.waitUntil(cacheShell().catch(() => undefined)));
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await warmAssets().catch(() => undefined);
      const names = await caches.keys().catch(() => [] as string[]);
      await Promise.allSettled(names.filter((n) => !OWN_CACHES.includes(n)).map((n) => caches.delete(n)));
    })().catch(() => undefined),
  );
});
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

// Hashed CSS/JS: cache-first and kept. The file name changes with its content, so a cached entry
// can never be the wrong version — and a fetch that fails here costs one load, never the update.
registerRoute(
  ({ url }) => isHashedAsset({ url, origin }),
  new CacheFirst({
    cacheName: ASSET_CACHE,
    plugins: [only200(), new ExpirationPlugin({ maxEntries: ASSET_MAX_ENTRIES, purgeOnQuotaError: true })],
  }),
);

// Icons and the manifest: from the shell cache, with the network as the fallback.
registerRoute(({ url }) => url.origin === origin && isShellPath(url.pathname) && url.pathname !== "/" && url.pathname !== "/index.html", new CacheFirst({ cacheName: SHELL_CACHE, plugins: [only200()] }));

// Everything else under /api: explicitly network only.
registerRoute(({ url }) => isApiRequest({ url, origin }), new NetworkOnly());

// Page loads: the network decides, and its HTML is never stored. The precached shell answers only
// when there is no usable network (`shouldSkipNetwork`), or when the request fails or hangs past
// NAVIGATION_TIMEOUT_SECONDS. A slow phone connection must not be enough to bring back a shell from
// an older deploy, which is why that timeout is generous rather than snappy.
const network = new NetworkOnly({ networkTimeoutSeconds: NAVIGATION_TIMEOUT_SECONDS });
const cachedShell = async () => (await caches.match("/index.html", { cacheName: SHELL_CACHE })) ?? Response.error();
registerRoute(
  ({ request, url }) => isNavigationRequest(request, url),
  async (ctx) => {
    if (shouldSkipNetwork(self.navigator.onLine)) return cachedShell();
    try {
      return await network.handle(ctx);
    } catch {
      return cachedShell();
    }
  },
);
