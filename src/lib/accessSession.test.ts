import { describe, expect, it, vi } from "vitest";
import { handleFetchFailure, probeSession, RELOAD_COOLDOWN_MS, type FailureDeps, type SessionProbe } from "./accessSession";

const respond = (init: { type: ResponseType; status: number }) =>
  (async () => ({ type: init.type, status: init.status }) as Response) as unknown as typeof fetch;

describe("probeSession", () => {
  it("opaqueredirect (Access login redirect) → expired; status 0 + opaque too", async () => {
    expect(await probeSession(respond({ type: "opaqueredirect", status: 0 }))).toBe("expired");
    expect(await probeSession(respond({ type: "opaque", status: 0 }))).toBe("expired");
  });

  it("a normal answer (even an error status) → ok; the server is reachable", async () => {
    expect(await probeSession(respond({ type: "basic", status: 200 }))).toBe("ok");
    expect(await probeSession(respond({ type: "basic", status: 401 }))).toBe("ok");
    expect(await probeSession(respond({ type: "error", status: 0 }))).toBe("ok");
  });

  it("fetch throwing (offline / flaky network) → offline", async () => {
    expect(await probeSession((async () => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch)).toBe("offline");
  });

  it("asks without following redirects and bypasses caches", async () => {
    const spy = vi.fn(respond({ type: "basic", status: 200 }));
    await probeSession(spy as unknown as typeof fetch);
    expect(spy).toHaveBeenCalledWith("/api/health", { redirect: "manual", cache: "no-store" });
  });
});

describe("handleFetchFailure", () => {
  const deps = (probe: SessionProbe, last: number | null = null) => {
    const state = { reloads: 0, marked: null as number | null };
    const d: FailureDeps = {
      probe: async () => probe,
      reload: () => void state.reloads++,
      lastReloadAt: () => last,
      markReload: (at) => void (state.marked = at),
      now: () => 1_000_000,
    };
    return { d, state };
  };

  it("expired session → reload once, remember the time", async () => {
    const { d, state } = deps("expired");
    expect(await handleFetchFailure(d)).toBe("reloading");
    expect(state).toEqual({ reloads: 1, marked: 1_000_000 });
  });

  it("network error (flaky or offline) → notice, never a reload", async () => {
    const { d, state } = deps("offline");
    expect(await handleFetchFailure(d)).toBe("offline");
    expect(state.reloads).toBe(0);
  });

  it("server reachable → transient: no reload, no notice", async () => {
    const { d, state } = deps("ok");
    expect(await handleFetchFailure(d)).toBe("transient");
    expect(state.reloads).toBe(0);
  });

  it("no reload loop: an expired session right after a reload only shows the notice", async () => {
    const recent = deps("expired", 1_000_000 - 5_000);
    expect(await handleFetchFailure(recent.d)).toBe("offline");
    expect(recent.state.reloads).toBe(0);
    const old = deps("expired", 1_000_000 - RELOAD_COOLDOWN_MS - 1);
    expect(await handleFetchFailure(old.d)).toBe("reloading");
  });
});
