// POST /api/enrich/sentence and /api/enrich/phrase (M2.6): AI help for items typed by hand.
// Adults only; cache-first; one LLM call per cache miss, counted in the profile's daily LLM quota.
import { Hono } from "hono";
import { enrichPhraseRequestSchema, enrichSentenceRequestSchema } from "../../shared/customItem";
import { WORD_ERRORS } from "../../shared/word";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";
import { runAiTask } from "../lib/aiTask";
import { zv } from "../lib/validate";
import { enrichPhraseWithCache, enrichSentenceWithCache } from "../services/customItem";
import type { ContentDeps } from "./words";

export const customEnrichRoutes = ({ makeLlm }: ContentDeps) =>
  new Hono<AppEnv>()
    .post("/sentence", zv("json", enrichSentenceRequestSchema), async (c) => {
      const input = c.req.valid("json");
      const denied = await requireAdult(c, input.profile_id);
      if (denied) return denied;
      const llm = makeLlm(c.env);
      if (!llm) return c.json({ error: WORD_ERRORS.aiNotConfigured }, 503);
      const run = await runAiTask(c, input.profile_id, (beforeLlmCall) =>
        enrichSentenceWithCache({ db: getDb(c.env), llm, input, beforeLlmCall }),
      );
      return run.ok ? c.json(run.result) : run.response;
    })

    .post("/phrase", zv("json", enrichPhraseRequestSchema), async (c) => {
      const input = c.req.valid("json");
      const denied = await requireAdult(c, input.profile_id);
      if (denied) return denied;
      const llm = makeLlm(c.env);
      if (!llm) return c.json({ error: WORD_ERRORS.aiNotConfigured }, 503);
      const run = await runAiTask(c, input.profile_id, (beforeLlmCall) =>
        enrichPhraseWithCache({ db: getDb(c.env), llm, input, beforeLlmCall }),
      );
      return run.ok ? c.json(run.result) : run.response;
    });
