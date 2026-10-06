import type { z } from "zod";
import { apiErrorSchema } from "@shared/api/error";

/** Thrown for non-2xx responses; `code` is the API's `error` field (e.g. "last_adult"). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`API ${status}: ${code}`);
    this.status = status;
    this.code = code;
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * Calls `/api{path}` and validates the JSON response with `schema`.
 * Pass `schema = null` for endpoints that return no body (204).
 */
export async function api<S extends z.ZodType>(method: Method, path: string, schema: S, body?: unknown): Promise<z.output<S>>;
export async function api(method: Method, path: string, schema: null, body?: unknown): Promise<void>;
export async function api(method: Method, path: string, schema: z.ZodType | null, body?: unknown): Promise<unknown> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw new ApiError(res.status, parsed.success ? parsed.data.error : "unknown");
  }
  return schema ? schema.parse(json) : undefined;
}
