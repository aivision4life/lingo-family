import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  enrichPhraseResponseSchema,
  enrichSentenceResponseSchema,
  type EnrichPhraseRequest,
  type EnrichSentenceRequest,
} from "@shared/customItem";
import { EXAMPLE_ERRORS, exampleSavedSchema, type ExampleCreate, type ExamplePatch } from "@shared/exampleEdit";
import { api } from "@/lib/api";

/** Word detail, the phrase lists and review payloads all show examples. */
const refresh = (qc: QueryClient) => Promise.all(["words", "phrases"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

// The request schemas validate on the server; the client sends plain objects.
type SentenceReq = Omit<EnrichSentenceRequest, "word_gloss"> & { word_gloss?: string };
type PhraseReq = Omit<EnrichPhraseRequest, "word_gloss"> & { word_gloss?: string };

export const useEnrichSentence = () =>
  useMutation({ mutationFn: (req: SentenceReq) => api("POST", "/enrich/sentence", enrichSentenceResponseSchema, req) });

export const useEnrichPhrase = () =>
  useMutation({ mutationFn: (req: PhraseReq) => api("POST", "/enrich/phrase", enrichPhraseResponseSchema, req) });

export function useAddExample(wordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ExampleCreate) => api("POST", `/words/${wordId}/examples`, exampleSavedSchema, body),
    onSuccess: () => refresh(qc),
  });
}

export function usePatchExample(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ExamplePatch) => api("PATCH", `/examples/${id}`, exampleSavedSchema, body),
    onSuccess: () => refresh(qc),
  });
}

export function useDeleteExample(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => api("DELETE", `/examples/${id}`, null, { profile_id: profileId }),
    onSuccess: () => refresh(qc),
  });
}

/** i18n key for an example API error. */
export function exampleErrorKey(error: unknown): "examples.errors.tooMany" | "examples.errors.duplicate" | "examples.errors.generic" {
  const body = error && typeof error === "object" && "body" in error ? error.body : null;
  const code = z.object({ error: z.string() }).safeParse(body);
  if (code.success && code.data.error === EXAMPLE_ERRORS.tooMany) return "examples.errors.tooMany";
  if (code.success && code.data.error === EXAMPLE_ERRORS.duplicate) return "examples.errors.duplicate";
  return "examples.errors.generic";
}
