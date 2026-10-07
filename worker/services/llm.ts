// LLM client behind a small interface so the provider can be switched by env var
// (LLM_PROVIDER / LLM_MODEL / LLM_API_KEY). Only Gemini is implemented for now.
import { z } from "zod";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
// Generous: under heavy load Gemini can take 30s+. Waiting costs no Worker CPU time.
const TIMEOUT_MS = 45_000;
const TRANSIENT_STATUS = new Set([500, 503]);
const TRANSIENT_RETRY_DELAY_MS = 1_000;

export type LlmErrorCode = "not_configured" | "unavailable" | "invalid_output";

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

export interface LlmClient {
  readonly model: string;
  /** Returns the raw text of the model's answer (expected to be JSON). */
  generate(req: LlmRequest): Promise<string>;
}

type LlmEnv = { LLM_PROVIDER?: string; LLM_MODEL?: string; LLM_API_KEY?: string };

/** Builds the client from env, or null when no API key / unknown provider is configured. */
export function createLlmClient(env: LlmEnv): LlmClient | null {
  const provider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  if (!env.LLM_API_KEY || provider !== "gemini") return null;
  return geminiClient(env.LLM_API_KEY, env.LLM_MODEL || DEFAULT_GEMINI_MODEL);
}

const geminiPartSchema = z.object({ text: z.string().optional(), thought: z.boolean().optional() });
const geminiResponseSchema = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(geminiPartSchema) }).optional() })).optional(),
});

function geminiClient(apiKey: string, model: string): LlmClient {
  return {
    model,
    async generate({ system, user, jsonSchema }) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          temperature: 0.2,
        },
      });
      const send = () =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

      let res: Response;
      try {
        res = await send();
        // "High demand" 500/503 errors are usually transient: wait briefly and retry once.
        if (TRANSIENT_STATUS.has(res.status)) {
          await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
          res = await send();
        }
      } catch (e) {
        throw new LlmError("unavailable", `Gemini request failed: ${String(e)}`);
      }
      if (!res.ok) {
        // Never include the request (it carries the key header) in errors.
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new LlmError("unavailable", `Gemini HTTP ${res.status}: ${detail}`);
      }
      const parsed = geminiResponseSchema.safeParse(await res.json().catch(() => null));
      const text = parsed.success
        ? parsed.data.candidates?.[0]?.content?.parts
            // Skip "thinking" parts; only the answer text is JSON.
            .filter((p) => !p.thought)
            .map((p) => p.text ?? "")
            .join("")
        : undefined;
      if (!text) throw new LlmError("invalid_output", "Gemini returned no text");
      return text;
    },
  };
}

/**
 * Asks for JSON matching `schema`. Invalid output (bad JSON or schema mismatch) is retried
 * once with the validation errors appended; a second failure throws `invalid_output`.
 */
export async function generateStructured<S extends z.ZodType>(
  llm: LlmClient,
  schema: S,
  req: Omit<LlmRequest, "jsonSchema">,
): Promise<z.output<S>> {
  const jsonSchema = z.toJSONSchema(schema);
  let user = req.user;
  let lastProblem = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await llm.generate({ system: req.system, user, jsonSchema });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      lastProblem = "The output was not valid JSON.";
      user = `${req.user}\n\n${lastProblem} Return only one JSON object.`;
      continue;
    }
    const result = schema.safeParse(json);
    if (result.success) return result.data;
    lastProblem = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    user = `${req.user}\n\nYour previous answer did not match the schema (${lastProblem}). Return corrected JSON only.`;
  }
  throw new LlmError("invalid_output", `Invalid LLM output after retry: ${lastProblem}`);
}
