import { validator } from "hono/validator";
import type { z } from "zod";
import type { ApiErrorBody } from "../../shared/api/error";

/**
 * Hono validator middleware backed by a zod schema.
 * Invalid input → 400 { error: "invalid_input", issues: [{ path, message }] }.
 * The handler reads the parsed value with `c.req.valid(target)`.
 */
export const zv = <T extends z.ZodType>(target: "json" | "param" | "query", schema: T) =>
  validator(target, (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      const body: ApiErrorBody = {
        error: "invalid_input",
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      };
      return c.json(body, 400);
    }
    return result.data as z.output<T>;
  });
