import type { z } from "zod";
import { apiErrorSchema } from "@shared/api/error";
import { noteFetchFailure, noteFetchSuccess } from "./connection";
import { devNowHeaders } from "./devClock";

/** Thrown for non-2xx responses; `code` is the API's `error` field (e.g. "last_adult"). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Full error body, for endpoints that add details (e.g. `existing_id`). */
  readonly body: unknown;

  constructor(status: number, code: string, body: unknown = null) {
    super(`API ${status}: ${code}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * fetch for /api. A network error (not an HTTP error status) triggers the session / connection
 * check in connection.ts before the error is rethrown to the caller.
 */
async function apiFetch(input: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (e) {
    await noteFetchFailure();
    throw e;
  }
  noteFetchSuccess();
  return res;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * Calls `/api{path}` and validates the JSON response with `schema`.
 * Pass `schema = null` for endpoints that return no body (204).
 */
export async function api<S extends z.ZodType>(method: Method, path: string, schema: S, body?: unknown): Promise<z.output<S>>;
export async function api(method: Method, path: string, schema: null, body?: unknown): Promise<void>;
export async function api(method: Method, path: string, schema: z.ZodType | null, body?: unknown): Promise<unknown> {
  const res = await apiFetch(`/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      // Dev time travel (empty in production builds).
      ...devNowHeaders(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw new ApiError(res.status, parsed.success ? parsed.data.error : "unknown", json);
  }
  return schema ? schema.parse(json) : undefined;
}

/** POSTs a binary body (e.g. an image upload) to `/api{path}` and validates the JSON response. */
export async function apiUpload<S extends z.ZodType>(path: string, body: Blob, schema: S): Promise<z.output<S>> {
  const res = await apiFetch(`/api${path}`, { method: "POST", headers: { "content-type": body.type }, body });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw new ApiError(res.status, parsed.success ? parsed.data.error : "unknown", json);
  }
  return schema.parse(json);
}
