import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { LearnLang } from "@shared/enums";
import {
  duplicateErrorSchema,
  enrichResponseSchema,
  wordDetailSchema,
  wordListSchema,
  type EnrichRequest,
  type WordCreate,
} from "@shared/word";
import { api } from "@/lib/api";

const WORDS_KEY = ["words"] as const;

export function useWords(filter: { lang?: LearnLang; q?: string }) {
  const params = new URLSearchParams();
  if (filter.lang) params.set("lang", filter.lang);
  if (filter.q) params.set("q", filter.q);
  const qs = params.toString();
  return useQuery({
    queryKey: [...WORDS_KEY, "list", filter],
    queryFn: () => api("GET", `/words${qs ? `?${qs}` : ""}`, wordListSchema),
    // Keep showing the old list while a new search loads (no flicker while typing).
    placeholderData: keepPreviousData,
  });
}

export function useWord(id: string) {
  return useQuery({
    queryKey: [...WORDS_KEY, "detail", id],
    queryFn: () => api("GET", `/words/${id}`, wordDetailSchema),
  });
}

export const useEnrichWord = () =>
  useMutation({ mutationFn: (req: EnrichRequest) => api("POST", "/words/enrich", enrichResponseSchema, req) });

export function useCreateWord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WordCreate) => api("POST", "/words", z.object({ id: z.string() }), input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORDS_KEY }),
  });
}

/** Id of the existing word when an API error is a duplicate, otherwise null. */
export function duplicateIdOf(error: unknown): string | null {
  const body = error && typeof error === "object" && "body" in error ? error.body : null;
  const parsed = duplicateErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.existing_id : null;
}
