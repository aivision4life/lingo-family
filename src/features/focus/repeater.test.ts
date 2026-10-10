import { describe, expect, it } from "vitest";
import { createRepeater, REPEAT_GAP_MS } from "./repeater";

/** A fake clock and audio element. */
function harness() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const ended = new Set<() => void>();
  const log: string[] = [];
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const repeater = createRepeater({
    play: () => void log.push(`play@${now}`),
    subscribeEnded: (l) => (ended.add(l), () => void ended.delete(l)),
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    onChange: (a) => void log.push(a ? "on" : "off"),
  });
  const finishSound = () => ended.forEach((l) => l());
  return { repeater, log, advance, finishSound, pending: () => timers.size, listeners: () => ended.size };
}

describe("createRepeater", () => {
  it("plays at once, then again 1.5 s after each time the sound ends", () => {
    const h = harness();
    h.repeater.start();
    expect(h.log).toEqual(["on", "play@0"]);
    h.advance(1000); // still playing: nothing happens
    h.finishSound();
    h.advance(REPEAT_GAP_MS - 1);
    expect(h.log).toEqual(["on", "play@0"]);
    h.advance(1);
    expect(h.log).toEqual(["on", "play@0", `play@${1000 + REPEAT_GAP_MS}`]);
    h.finishSound();
    h.advance(REPEAT_GAP_MS);
    expect(h.log.filter((l) => l.startsWith("play"))).toHaveLength(3);
  });

  it("stopping cancels the pending replay and releases the listener", () => {
    const h = harness();
    h.repeater.start();
    h.finishSound();
    expect(h.pending()).toBe(1);
    h.repeater.stop();
    expect(h.pending()).toBe(0);
    expect(h.listeners()).toBe(0);
    h.advance(10_000);
    expect(h.log.filter((l) => l.startsWith("play"))).toHaveLength(1);
    expect(h.log.at(-1)).toBe("off");
  });

  it("toggle starts and stops; starting twice does not double the loop", () => {
    const h = harness();
    h.repeater.toggle();
    h.repeater.start();
    expect(h.listeners()).toBe(1);
    expect(h.repeater.isActive()).toBe(true);
    h.repeater.toggle();
    expect(h.repeater.isActive()).toBe(false);
    h.repeater.stop(); // stopping when idle is harmless
    expect(h.log.filter((l) => l === "off")).toHaveLength(1);
  });
});
