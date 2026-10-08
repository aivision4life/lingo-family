import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { ExampleLevel, LearnLang } from "@shared/enums";
import {
  phraseListSchema,
  savePhrasesResponseSchema,
  suggestPhrasesResponseSchema,
  type PhraseInput,
  type PhraseUpdate,
} from "@shared/phrase";
import { api } from "@/lib/api";

// Phrases are shown inside words (detail, library counts, review), so invalidate those too.
const invalidateContent = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ["words"] }),
    qc.invalidateQueries({ queryKey: ["phrases"] }),
    qc.invalidateQueries({ queryKey: ["review"] }),
  ]);

export function usePhrases(filter: { lang?: LearnLang; q?: string }, enabled: boolean) {
  const params = new URLSearchParams();
  if (filter.lang) params.set("lang", filter.lang);
  if (filter.q) params.set("q", filter.q);
  const qs = params.toString();
  return useQuery({
    queryKey: ["phrases", "list", filter],
    queryFn: () => api("GET", `/phrases${qs ? `?${qs}` : ""}`, phraseListSchema),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const useSuggestPhrases = (wordId: string) =>
  useMutation({
    mutationFn: (v: { profileId: string; level: ExampleLevel }) =>
      api("POST", `/words/${wordId}/phrases/suggest`, suggestPhrasesResponseSchema, {
        profile_id: v.profileId,
        level: v.level,
      }),
  });

export function useSavePhrases(wordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { profileId: string; phrases: PhraseInput[] }) =>
      api("POST", `/words/${wordId}/phrases`, savePhrasesResponseSchema, { profile_id: v.profileId, phrases: v.phrases }),
    onSuccess: () => invalidateContent(qc),
  });
}

export function useUpdatePhrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PhraseUpdate }) =>
      api("PATCH", `/phrases/${id}`, z.object({ id: z.string() }), patch),
    onSuccess: () => invalidateContent(qc),
  });
}

export function useDeletePhrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, profileId }: { id: string; profileId: string }) =>
      api("DELETE", `/phrases/${id}`, null, { profile_id: profileId }),
    onSuccess: () => invalidateContent(qc),
  });
}

export function useDeleteWord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, profileId }: { id: string; profileId: string }) =>
      api("DELETE", `/words/${id}`, null, { profile_id: profileId }),
    onSuccess: () => invalidateContent(qc),
  });
}
