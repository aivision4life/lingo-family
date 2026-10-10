import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearnLang } from "@shared/enums";
import {
  answerResponseSchema,
  queueResponseSchema,
  summarySchema,
  type AnswerRequest,
} from "@shared/review";
import { api } from "@/lib/api";
import { tzOffsetMinutes, useDevDayOffset } from "@/lib/devClock";

const REVIEW_KEY = ["review"] as const;

export function useReviewSummary(profileId: string) {
  const devOffset = useDevDayOffset();
  return useQuery({
    queryKey: [...REVIEW_KEY, "summary", profileId, devOffset],
    queryFn: () => api("GET", `/review/summary?profile_id=${profileId}&tz=${tzOffsetMinutes()}`, summarySchema),
  });
}

/** Loaded once per session; the session then manages its own queue. */
export function useReviewQueue(profileId: string, lang: LearnLang, album?: string) {
  const devOffset = useDevDayOffset();
  return useQuery({
    queryKey: [...REVIEW_KEY, "queue", profileId, lang, album ?? null, devOffset],
    queryFn: () =>
      api(
        "GET",
        `/review/queue?profile_id=${profileId}&lang=${lang}&tz=${tzOffsetMinutes()}${album ? `&album=${encodeURIComponent(album)}` : ""}`,
        queueResponseSchema,
      ),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useAnswerCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: AnswerRequest) => api("POST", "/review/answer", answerResponseSchema, req),
    // Home counts must be fresh after a session (the running queue is not refetched).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...REVIEW_KEY, "summary"] }),
  });
}
