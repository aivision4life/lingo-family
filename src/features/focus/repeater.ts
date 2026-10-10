// "Repeat": play the sound again and again with a pause between plays, until stopped. The timing
// logic is separate from the browser (everything is injected) so it can be unit tested.

export const REPEAT_GAP_MS = 1500;

export type RepeaterDeps = {
  /** Starts the sound from the beginning. */
  play: () => void;
  /** Subscribes to "the sound ended by itself"; returns an unsubscribe function. */
  subscribeEnded: (listener: () => void) => () => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  gapMs?: number;
  onChange?: (active: boolean) => void;
};

export function createRepeater(deps: RepeaterDeps) {
  const gap = deps.gapMs ?? REPEAT_GAP_MS;
  let active = false;
  let timer: unknown = null;
  let unsubscribe: (() => void) | null = null;

  const clear = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };

  const stop = () => {
    if (!active) return;
    active = false;
    clear();
    unsubscribe?.();
    unsubscribe = null;
    deps.onChange?.(false);
  };

  const start = () => {
    if (active) return;
    active = true;
    deps.onChange?.(true);
    unsubscribe = deps.subscribeEnded(() => {
      if (!active) return;
      clear();
      timer = deps.setTimer(() => {
        timer = null;
        if (active) deps.play();
      }, gap);
    });
    deps.play();
  };

  return { start, stop, toggle: () => (active ? stop() : start()), isActive: () => active };
}
