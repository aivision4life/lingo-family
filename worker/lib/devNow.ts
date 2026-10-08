import { z } from "zod";
import { DEV_NOW_HEADER } from "../../shared/review";

const devFlagSchema = z.object({ DEV_TIME_TRAVEL: z.literal("1") });

/**
 * "Now" for scheduling. The X-Dev-Now header (fake date for trying schedules locally) is read
 * only when DEV_TIME_TRAVEL=1 is set in .dev.vars; production never sets it, so it is ignored.
 */
export function resolveNow(env: unknown, header: string | undefined, real = new Date()): Date {
  if (!header || !devFlagSchema.safeParse(env).success) return real;
  const fake = new Date(header);
  return Number.isNaN(fake.getTime()) ? real : fake;
}

export { DEV_NOW_HEADER };
