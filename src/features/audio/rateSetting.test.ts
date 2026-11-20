import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRate, createRateSetting, formatRate } from "./rateSetting";

/** Just enough of `localStorage` to prove what is remembered, and to be able to refuse. */
function fakeStorage(initial: Record<string, string> = {}, refuse = false) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => {
      if (refuse) throw new Error("storage refused");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (refuse) throw new Error("storage refused");
      data.set(k, v);
    },
  };
}

const RATES = [1, 0.9, 0.8] as const;

afterEach(() => vi.unstubAllGlobals());

describe("createRateSetting", () => {
  it("starts at the default when nothing is stored", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(createRateSetting("k", RATES, 0.8).get()).toBe(0.8);
  });

  it("reads back a speed the device remembers", () => {
    vi.stubGlobal("localStorage", fakeStorage({ k: "0.9" }));
    expect(createRateSetting("k", RATES, 0.8).get()).toBe(0.9);
  });

  it("refuses a stored value that is not one of the choices", () => {
    // An old build's value, or a hand-edited one: the default is the only safe answer.
    for (const stored of ["0.5", "2", "", "abc", "0.80000001"]) {
      vi.stubGlobal("localStorage", fakeStorage({ k: stored }));
      expect(createRateSetting("k", RATES, 0.8).get()).toBe(0.8);
    }
  });

  it("remembers a new speed and tells its listeners", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const setting = createRateSetting("k", RATES, 0.8);
    let heard = 0;
    const stop = setting.subscribe(() => (heard += 1));

    setting.set(1);
    expect(setting.get()).toBe(1);
    expect(storage.data.get("k")).toBe("1");
    expect(heard).toBe(1);

    stop();
    setting.set(0.9);
    expect(setting.get()).toBe(0.9);
    expect(heard).toBe(1);
  });

  it("still works when storage is refused, as in a private window", () => {
    vi.stubGlobal("localStorage", fakeStorage({}, true));
    const setting = createRateSetting("k", RATES, 0.8);
    expect(setting.get()).toBe(0.8);
    expect(() => setting.set(0.9)).not.toThrow();
    expect(setting.get()).toBe(0.9);
  });
});

describe("applyRate", () => {
  let el: { playbackRate: number; defaultPlaybackRate: number; preservesPitch: boolean };
  beforeEach(() => {
    el = { playbackRate: 1, defaultPlaybackRate: 1, preservesPitch: false };
  });

  it("sets both rates, because a new source resets playbackRate to the default one", () => {
    applyRate(el as unknown as HTMLAudioElement, 0.8);
    expect(el.playbackRate).toBe(0.8);
    expect(el.defaultPlaybackRate).toBe(0.8);
  });

  it("keeps the pitch, so a slower voice does not come out deeper", () => {
    applyRate(el as unknown as HTMLAudioElement, 0.8);
    expect(el.preservesPitch).toBe(true);
  });
});

describe("formatRate", () => {
  it("writes a whole number with its decimal, so the choices line up", () => {
    expect(formatRate(1)).toBe("1.0");
    expect(formatRate(0.9)).toBe("0.9");
    expect(formatRate(0.8)).toBe("0.8");
  });
});
