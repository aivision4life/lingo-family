// Image quota resets at UTC midnight (worker/lib/quota.ts `usageDate()`). Pure date logic, tested;
// formatting for display is the component's job (it needs the viewer's own locale/timezone).

/** The next UTC midnight strictly after `now` (now = UTC midnight itself → the one a day later). */
export function nextUtcMidnight(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
}
