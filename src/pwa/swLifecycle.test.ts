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

  it("registers the worker in autoUpdate mode (activation is not gated on a button)", () => {
    expect(viteConfigSource).toContain('registerType: "autoUpdate"');
  });

  it("lets the app decide when to reload instead of reloading by itself", () => {
    // Without `onNeedReload`, vite-plugin-pwa's autoUpdate mode reloads the page the moment a new
    // worker activates, which would throw away a review or TOPIK session in progress.
    expect(updateBannerSource).toContain("onNeedReload()");
  });
});
