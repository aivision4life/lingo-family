// "when does the next question come due" as a short phrase (M7.2). Pure, so it is unit tested.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long until `targetMs`, as `Intl.RelativeTimeFormat` would say it in `locale` ("sau 10 phút",
 * "in 2 hours", "3일 후").
 *
 * The unit is chosen by size rather than always using minutes: a card due in three days as "sau
 * 4320 phút" is technically right and useless. Anything already due, or due within the next
 * minute, reads as "now" — the picker and the empty-session screen both use this to explain why a
 * block has nothing to serve, and "due in 12 seconds" is not a reason anyone needs spelled out.
 */
export function formatDueIn(targetMs: number, nowMs: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const delta = targetMs - nowMs;
  // Zero *seconds*, not zero minutes: "now" / "bây giờ" rather than "this minute" / "phút này".
  if (delta < MINUTE) return rtf.format(0, "second");
  if (delta < HOUR) return rtf.format(Math.round(delta / MINUTE), "minute");
  if (delta < DAY) return rtf.format(Math.round(delta / HOUR), "hour");
  return rtf.format(Math.round(delta / DAY), "day");
}

/** Whether anything in this block can be practised right now, by the same rule the session uses. */
export const hasSomethingToPractise = (b: { unseen: number; due: number }) => b.unseen + b.due > 0;

/**
 * `formatDueIn` against the current clock. It lives here, at module scope, because
 * `react-hooks/purity` rightly refuses a `Date.now()` call during render — and the rendered value
 * really is a moment in time, re-read on each render, which is what a countdown should do. The
 * pure function above keeps the logic testable.
 */
export const formatDueFromNow = (targetMs: number, locale: string) => formatDueIn(targetMs, Date.now(), locale);
