/** i18n key + count for an interval shown under a rating button ("10 min", "3 d", …). */
export type IntervalLabel = {
  key: "lessThanMinute" | "minutes" | "hours" | "days" | "months" | "years";
  count: number;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function intervalLabel(ms: number): IntervalLabel {
  if (ms < MIN) return { key: "lessThanMinute", count: 0 };
  if (ms < HOUR) return { key: "minutes", count: Math.round(ms / MIN) };
  if (ms < DAY) return { key: "hours", count: Math.round(ms / HOUR) };
  if (ms < 30 * DAY) return { key: "days", count: Math.round(ms / DAY) };
  if (ms < 365 * DAY) return { key: "months", count: Math.round(ms / (30 * DAY)) };
  return { key: "years", count: Math.round((ms / (365 * DAY)) * 10) / 10 };
}
