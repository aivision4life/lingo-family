import { describe, expect, it } from "vitest";
import {
  isApiRequest,
  isCacheableStatus,
  isFontRequest,
  isMediaRequest,
  isNavigationRequest,
  MEDIA_MAX_AGE_SECONDS,
  MEDIA_MAX_ENTRIES,
  NAVIGATION_TIMEOUT_SECONDS,
  shouldSkipNetwork,
} from "./swRoutes";

const ORIGIN = "https://lingo.ai4life.workers.dev";
const req = (path: string, origin = ORIGIN) => ({ url: new URL(path, origin), origin: ORIGIN });

describe("service worker routes", () => {
  it("media: only same-origin /api/media/*", () => {
    expect(isMediaRequest(req("/api/media/images/ai/abc.png"))).toBe(true);
    expect(isMediaRequest(req("/api/media/audio/ko/v/abc.mp3"))).toBe(true);
    expect(isMediaRequest(req("/api/media/x", "https://evil.example"))).toBe(false);
    expect(isMediaRequest(req("/api/words"))).toBe(false);
    expect(isMediaRequest(req("/media/x"))).toBe(false);
  });

  it("api: every /api route except media is network-only", () => {
    for (const p of ["/api/health", "/api/profiles", "/api/review/queue?x=1", "/api/words/enrich", "/api/usage"]) {
      expect(isApiRequest(req(p)), p).toBe(true);
    }
    expect(isApiRequest(req("/api/media/images/ai/a.png"))).toBe(false);
    expect(isApiRequest(req("/api/health", "https://other.example"))).toBe(false);
  });

  it("fonts: hashed woff/woff2 files under /assets", () => {
    expect(isFontRequest(req("/assets/noto-sans-kr-12-400-normal-AbC.woff2"))).toBe(true);
    expect(isFontRequest(req("/assets/noto-sans-kr-12-400-normal-AbC.woff"))).toBe(true);
    expect(isFontRequest(req("/assets/index-abc.js"))).toBe(false);
    expect(isFontRequest(req("/fonts/x.woff2"))).toBe(false);
  });

  it("navigation: page loads outside /api only", () => {
    expect(isNavigationRequest({ mode: "navigate" }, new URL("/home", ORIGIN))).toBe(true);
    expect(isNavigationRequest({ mode: "navigate" }, new URL("/", ORIGIN))).toBe(true);
    expect(isNavigationRequest({ mode: "navigate" }, new URL("/api/health", ORIGIN))).toBe(false);
    expect(isNavigationRequest({ mode: "cors" }, new URL("/home", ORIGIN))).toBe(false);
  });

  it("only a plain 200 is cacheable: no redirects (Access login), no partial or error responses", () => {
    expect(isCacheableStatus(200)).toBe(true);
    for (const s of [0, 206, 301, 302, 304, 401, 403, 404, 500]) expect(isCacheableStatus(s), String(s)).toBe(false);
  });

  it("media cache limits: 800 entries, 60 days", () => {
    expect(MEDIA_MAX_ENTRIES).toBe(800);
    expect(MEDIA_MAX_AGE_SECONDS).toBe(60 * 24 * 3600);
  });
});

describe("shouldSkipNetwork", () => {
  it("uses the network whenever the device is online, so a page load cannot come from a stale shell", () => {
    expect(shouldSkipNetwork(true)).toBe(false);
  });

  it("goes straight to the precached shell when offline, with no wait", () => {
    expect(shouldSkipNetwork(false)).toBe(true);
  });
});

describe("NAVIGATION_TIMEOUT_SECONDS", () => {
  it("is long enough that a slow connection does not fall back to the cached shell", () => {
    // The fallback is how an older deploy's HTML comes back; it must be a last resort.
    expect(NAVIGATION_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(10);
  });
});
