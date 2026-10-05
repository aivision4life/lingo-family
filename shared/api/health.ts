import { z } from "zod";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  profileCount: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
