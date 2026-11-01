/**
 * What Settings shows about the running build, so a deploy can be checked from a phone, where there
 * are no developer tools (`BuildInfo.tsx`). Pure, so the rules are unit tested.
 */
export type SwState = "unsupported" | "none" | "active" | "waiting";

/**
 * How the service worker is doing, from the browser's point of view.
 *
 *  - `unsupported`: no service worker API (a browser without it, or a non-secure origin);
 *  - `none`: supported, but no worker controls this page yet (first visit, or it was unregistered);
 *  - `active`: a worker is in charge — the normal state;
 *  - `waiting`: a newer worker installed but has not taken over. With `skipWaiting()` on install
 *    (src/sw.ts) this must never happen; seeing it means the stuck-update bug is back, which is why
 *    it wins over `active` instead of being hidden by it.
 */
export function swStateOf(args: { supported: boolean; hasController: boolean; hasWaiting: boolean }): SwState {
  if (!args.supported) return "unsupported";
  if (args.hasWaiting) return "waiting";
  return args.hasController ? "active" : "none";
}

/** `waiting` is the one state that needs attention; the others are normal. */
export const isSwStateHealthy = (state: SwState) => state !== "waiting";
