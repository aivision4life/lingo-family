// Real silence for the thinking gap (SPEC F13, M8.2).
//
// The gap is a timer and no audio at all (M8.1), which is right for the day its length becomes
// adjustable — a gap made of generated files would have to be regenerated to change 3 s into 5 s.
// With the screen off, though, a page with nothing playing is a page the browser may throttle to
// a timer a minute late and a session it may treat as over: the lock-screen controls go away and
// the podcast never leaves the gap. So the gap keeps its timer, and alongside it a short silent
// file loops on an element of its own, so that something is always playing.
//
// The file is real silence, not a data URI: a one-second 8 kHz mono WAV, 8 KB, precached by the
// service worker like every other asset, and it loops for as long as the gap lasts. Nothing about
// the gap's length lives in the file, so 3/5/8 seconds stays a change of one number.
export const GAP_SILENCE_SRC = "/silence-1s.wav";

export type TapeSilence = {
  /** Unlocked inside the starting gesture, like the two speaking elements. */
  unlock: () => Promise<boolean>;
  start: () => void;
  stop: () => void;
  dispose: () => void;
};

export function createTapeSilence(): TapeSilence {
  const el = new Audio();
  el.preload = "auto";
  el.loop = true;
  el.src = GAP_SILENCE_SRC;

  return {
    unlock: () =>
      el
        .play()
        .then(() => {
          el.pause();
          el.currentTime = 0;
          return true;
        })
        .catch(() => false),
    start() {
      // Failures are swallowed on purpose: the gap is kept by its timer either way, so a silent
      // file that will not play costs the screen-off case, never the gap itself.
      el.currentTime = 0;
      void el.play().catch(() => undefined);
    },
    stop() {
      el.pause();
    },
    dispose() {
      el.pause();
      el.removeAttribute("src");
    },
  };
}
