// Guards the service worker's update lifecycle (src/sw.ts, vite.config.ts). These assert on the
// source text, which is unusual, but the thing being protected cannot be observed from a unit test:
// a worker stuck in `waiting` only shows up on a real device, and when it does, the app is already
// broken and cannot be used to fix itself. A change that reintroduced it would otherwise stay
// invisible until someone's phone was stuck again.
import swSource from "../sw.ts?raw";
import viteConfigSource from "../../vite.config.ts?raw";
import updateBannerSource from "../features/pwa/UpdateBanner.tsx?raw";
import { describe, expect, it } from "vitest";

describe("service worker update lifecycle", () => {
  it("calls skipWaiting() on install, so a new worker never waits for the app", () => {
    expect(swSource).toMatch(/addEventListener\("install",\s*\(\)\s*=>\s*void self\.skipWaiting\(\)\)/);
  });

  it("claims open pages, so they stop being served by the previous precache", () => {
    expect(swSource).toContain("clientsClaim()");
  });

  it("drops caches left by an earlier version", () => {
    expect(swSource).toContain("cleanupOutdatedCaches()");
  });

  // M7.4, the second time a phone was stuck on an old build — the first was a worker left in
  // `waiting`, this one a single stylesheet that answered 500. The principle both come down to:
  // activation may not depend on anything that can fail.
  it("never hands the build manifest to precacheAndRoute, whose install fails on one bad file", () => {
    // The call, not the word: the comment above it explains why it is gone.
    expect(swSource).not.toMatch(/precacheAndRoute\(/);
  });

  it("swallows every failure in install and activate", () => {
    // One `catch` per handler, and `allSettled` inside, so no single file can reject the install.
    expect(swSource).toMatch(/addEventListener\("install", \(event\) => void event\.waitUntil\(cacheShell\(\)\.catch\(/);
    expect(swSource).toMatch(/Promise\.allSettled/);
  });

  it("caches only the shell at install, and lets the rest be cached when it is used", () => {
    // index.html + icons: small, and the only files the app cannot start without.
    expect(swSource).toContain("isShellPath(p)");
    expect(swSource).toContain("isHashedAsset({ url, origin })");
  });

  it("registers the worker in autoUpdate mode (activation is not gated on a button)", () => {
    expect(viteConfigSource).toContain('registerType: "autoUpdate"');
  });

  it("lets the app decide when to reload instead of reloading by itself", () => {
    // Without `onNeedReload`, vite-plugin-pwa's autoUpdate mode reloads the page the moment a new
    // worker activates, which would throw away a review or TOPIK session in progress.
    expect(updateBannerSource).toContain("onNeedReload()");
  });
});
