import { localFlag } from "./localDev";
import { DEV_NOW_HEADER } from "../../shared/review";

/**
 * "Now" for scheduling. The X-Dev-Now header (fake date for trying schedules locally) is read
 * only when DEV_TIME_TRAVEL=1 is set in .dev.vars AND the request goes to a local host, so it
 * is ignored in production even if the flag were set by mistake.
 */
export function resolveNow(env: unknown, header: string | undefined, requestUrl: string, real = new Date()): Date {
  if (!header || !localFlag(env, "DEV_TIME_TRAVEL", requestUrl)) return real;
  const fake = new Date(header);
  return Number.isNaN(fake.getTime()) ? real : fake;
}

export { DEV_NOW_HEADER };
