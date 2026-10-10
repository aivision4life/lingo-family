import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearnLang } from "@shared/enums";
import {
  audioResultSchema,
  duplicateErrorSchema,
  enrichResponseSchema,
  wordDetailSchema,
  wordCreatedSchema,
  wordListSchema,
  type EnrichRequest,
  type WordCreate,
  type WordDetail,
  type WordSummary,
} from "@shared/word";
import { pollWhilePending } from "@/features/images/api";
import { api } from "@/lib/api";

const WORDS_KEY = ["words"] as const;

/** `album`: an album id, or "none" for words that are in no album. */
export function useWords(filter: { lang?: LearnLang; q?: string; album?: string }) {
  const params = new URLSearchParams();
  if (filter.lang) params.set("lang", filter.lang);
  if (filter.album) params.set("album", filter.album);
  if (filter.q) params.set("q", filter.q);
  const qs = params.toString();
  return useQuery({
    queryKey: [...WORDS_KEY, "list", filter],
    queryFn: () => api("GET", `/words${qs ? `?${qs}` : ""}`, wordListSchema),
    // Keep showing the old list while a new search loads (no flicker while typing).
    placeholderData: keepPreviousData,
    // Thumbnails being drawn in the background appear without a manual refresh.
    refetchInterval: pollWhilePending((list: WordSummary[]) => list),
  });
}

/** Every image on Word detail: the word, its examples, its phrases and their examples. */
const detailImages = (w: WordDetail) => [w, ...w.examples, ...w.phrases.flatMap((p) => [p, ...p.examples])];

export function useWord(id: string) {
  return useQuery({
    queryKey: [...WORDS_KEY, "detail", id],
    queryFn: () => api("GET", `/words/${id}`, wordDetailSchema),
    refetchInterval: pollWhilePending(detailImages),
  });
}

export const useEnrichWord = () =>
  useMutation({ mutationFn: (req: EnrichRequest) => api("POST", "/words/enrich", enrichResponseSchema, req) });

export function useCreateWord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WordCreate) => api("POST", "/words", wordCreatedSchema, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORDS_KEY }),
  });
}

/** Generates the missing audio of a saved word; returns how many items are still missing. */
export function useGenerateAudio(wordId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) =>
      api("POST", `/words/${wordId}/audio`, audioResultSchema, { profile_id: profileId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORDS_KEY }),
  });
}

/** Id of the existing word when an API error is a duplicate, otherwise null. */
export function duplicateIdOf(error: unknown): string | null {
  const body = error && typeof error === "object" && "body" in error ? error.body : null;
  const parsed = duplicateErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.existing_id : null;
}
