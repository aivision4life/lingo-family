import { describe, expect, it } from "vitest";
import { isSwStateHealthy, swStateOf } from "./swState";

describe("swStateOf", () => {
  it("reports the normal case: a worker is in charge", () => {
    expect(swStateOf({ supported: true, hasController: true, hasWaiting: false })).toBe("active");
  });

  it("reports a first visit, before any worker controls the page", () => {
    expect(swStateOf({ supported: true, hasController: false, hasWaiting: false })).toBe("none");
  });

  it("reports a stuck update even while another worker is active", () => {
    // The bug this screen exists to catch: a new version installed but never took over.
    expect(swStateOf({ supported: true, hasController: true, hasWaiting: true })).toBe("waiting");
  });

  it("reports a browser without service workers", () => {
    expect(swStateOf({ supported: false, hasController: false, hasWaiting: true })).toBe("unsupported");
  });
});

describe("isSwStateHealthy", () => {
  it("flags only the waiting state", () => {
    expect(isSwStateHealthy("active")).toBe(true);
    expect(isSwStateHealthy("none")).toBe(true);
    expect(isSwStateHealthy("unsupported")).toBe(true);
    expect(isSwStateHealthy("waiting")).toBe(false);
  });
});
