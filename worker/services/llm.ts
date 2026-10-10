// LLM client behind a small interface so the provider can be switched by env var
// (LLM_PROVIDER / LLM_MODEL / LLM_FALLBACK_MODEL / LLM_API_KEY). Only Gemini is implemented for now.
import { z } from "zod";
import { AttemptError, RETRYABLE_STATUS, retryAfterMs, runWithRetry, type RetryOptions } from "./llmRetry";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/**
 * unavailable = busy/overloaded after all retries (try again later);
 * rejected = the provider refused the request (400/401/403/404: key, model or request problem).
 */
export type LlmErrorCode = "not_configured" | "unavailable" | "rejected" | "invalid_output";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type LlmRequest = {
  system: string;
  user: string;
  /** JSON Schema the provider should constrain its output to. */
  jsonSchema: object;
};

/** The answer text (expected to be JSON) and the model that actually produced it. */
export type LlmResult = { text: string; model: string };

export interface LlmClient {
  /** The primary model (part of cache keys, so fallback answers are reused too). */
  readonly model: string;
  generate(req: LlmRequest): Promise<LlmResult>;
}

type LlmEnv = { LLM_PROVIDER?: string; LLM_MODEL?: string; LLM_FALLBACK_MODEL?: string; LLM_API_KEY?: string };
export type LlmClientOptions = RetryOptions & { fetch?: typeof fetch };

/** Builds the client from env, or null when no API key / unknown provider is configured. */
export function createLlmClient(env: LlmEnv, opts: LlmClientOptions = {}): LlmClient | null {
  // Values pasted into `wrangler secret put` can carry a trailing newline or space: trim them.
  const provider = (env.LLM_PROVIDER?.trim() || "gemini").toLowerCase();
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey || provider !== "gemini") return null;
  const model = env.LLM_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const fallbackModel = env.LLM_FALLBACK_MODEL?.trim();
  const fallback = fallbackModel && fallbackModel !== model ? fallbackModel : null;
  const doFetch = opts.fetch ?? fetch;

  return {
    model,
    async generate(req) {
      const outcome = await runWithRetry(model, fallback, (m, timeoutMs) => geminiAttempt(doFetch, apiKey, m, req, timeoutMs), opts);
      if (outcome.ok) return { text: outcome.text, model: outcome.model };
      const { error } = outcome;
      throw new LlmError(error.retryable ? "unavailable" : "rejected", error.message);
    },
  };
}

const geminiPartSchema = z.object({ text: z.string().optional(), thought: z.boolean().optional() });
const geminiResponseSchema = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(geminiPartSchema) }).optional() })).optional(),
});

const geminiErrorSchema = z.object({
  error: z.object({ message: z.string().optional(), status: z.string().optional() }),
});
const DETAIL_MAX = 300;

/**
 * Short, key-free description of a failed Gemini response (max 300 chars): the API's
 * `error.status: error.message` when the body is JSON, else the raw text, else — for an empty
 * body — a few response headers that tell who answered (Google, a proxy, an edge rule).
 */
export function describeGeminiError(status: number, bodyText: string, headers: Headers): string {
  let json: unknown = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    // not JSON
  }
  const parsed = geminiErrorSchema.safeParse(json);
  let detail: string;
  if (parsed.success && (parsed.data.error.status || parsed.data.error.message)) {
    detail = `${parsed.data.error.status ?? status}: ${parsed.data.error.message ?? ""}`;
  } else if (bodyText.trim()) {
    detail = bodyText.trim();
  } else {
    const h = (name: string) => headers.get(name);
    detail = `(empty body) content-type=${h("content-type") ?? "-"} server=${h("server") ?? "-"} via=${h("via") ?? "-"} cf-ray=${h("cf-ray") ?? "-"}`;
  }
  return detail.replace(/\s+/g, " ").slice(0, DETAIL_MAX);
}

/** One generateContent call. HTTP / network problems become AttemptError (retryable or not). */
async function geminiAttempt(doFetch: typeof fetch, apiKey: string, model: string, req: LlmRequest, timeoutMs: number) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema, temperature: 0.2 },
  });

  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body,
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
  } catch (e) {
    // Network error or timeout: transient.
    throw new AttemptError(`Gemini request failed (${model}): ${String(e)}`, null, true);
  }
  if (!res.ok) {
    // Never include the request (URL, headers) in errors or logs: the key travels in a header.
    const detail = describeGeminiError(res.status, await res.text().catch(() => ""), res.headers);
    console.error(`[llm] Gemini error (${model}): ${detail}`);
    const retryable = RETRYABLE_STATUS.has(res.status);
    throw new AttemptError(`Gemini HTTP ${res.status} (${model}): ${detail}`, res.status, retryable, retryAfterMs(res.headers.get("retry-after")));
  }
  const parsed = geminiResponseSchema.safeParse(await res.json().catch(() => null));
  const text = parsed.success
    ? parsed.data.candidates?.[0]?.content?.parts
        // Skip "thinking" parts; only the answer text is JSON.
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("")
    : undefined;
  if (!text) throw new LlmError("invalid_output", `Gemini returned no text (${model})`);
  return text;
}

/**
 * Asks for JSON matching `schema`. Invalid output (bad JSON or schema mismatch) is retried
 * once with the validation errors appended; a second failure throws `invalid_output`.
 * Returns the data and the model that produced it (the fallback model, if it was used).
 */
export async function generateStructured<S extends z.ZodType>(
  llm: LlmClient,
  schema: S,
  req: Omit<LlmRequest, "jsonSchema">,
): Promise<{ data: z.output<S>; model: string }> {
  const jsonSchema = z.toJSONSchema(schema);
  let user = req.user;
  let lastProblem = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, model } = await llm.generate({ system: req.system, user, jsonSchema });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      lastProblem = "The output was not valid JSON.";
      user = `${req.user}\n\n${lastProblem} Return only one JSON object.`;
      continue;
    }
    const result = schema.safeParse(json);
    if (result.success) return { data: result.data, model };
    lastProblem = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    user = `${req.user}\n\nYour previous answer did not match the schema (${lastProblem}). Return corrected JSON only.`;
  }
  throw new LlmError("invalid_output", `Invalid LLM output after retry: ${lastProblem}`);
}
