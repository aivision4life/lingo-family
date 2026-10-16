import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  topikAttemptResultSchema,
  topikBlockListSchema,
  topikFacetsSchema,
  topikImageUploadResponseSchema,
  topikQuestionPageSchema,
  topikQuestionSchema,
  topikSessionResponseSchema,
  topikVerifyBulkResponseSchema,
  type TopikQuestionInput,
  type TopikQuestionUpdate,
  type TopikVerifyBulkRequest,
} from "@shared/topik";
import { api, apiUpload } from "@/lib/api";

/** Pages of 30; the review screen (M6.1+, filters/search added as the bank grows past ~600 rows)
 * loads more as the adult scrolls/taps "Tải thêm" instead of fetching everything at once. */
const TOPIK_MANAGE_PAGE_SIZE = 30;

export type TopikQuestionFilter = { verified?: boolean; exam?: string; block?: string; q?: string };

export const useTopikBlocks = () =>
  useQuery({ queryKey: ["topik", "blocks"], queryFn: () => api("GET", "/topik/blocks?section=reading", topikBlockListSchema) });

export const useTopikSession = (profileId: string, from: number, to: number) =>
  useQuery({
    queryKey: ["topik", "session", profileId, from, to],
    queryFn: () => api("GET", `/topik/session?profile_id=${profileId}&section=reading&from=${from}&to=${to}`, topikSessionResponseSchema),
    enabled: from > 0 && to > 0,
  });

export const useSubmitTopikAttempt = () =>
  useMutation({
    mutationFn: (body: { profile_id: string; question_id: string; selected_option: number; duration_ms: number }) =>
      api("POST", "/topik/attempts", topikAttemptResultSchema, body),
  });

// --- Management (adults only) -------------------------------------------------------------------

export function useTopikQuestionsPaged(profileId: string, filter: TopikQuestionFilter) {
  const params = new URLSearchParams({ profile_id: profileId, limit: String(TOPIK_MANAGE_PAGE_SIZE) });
  if (filter.verified !== undefined) params.set("verified", filter.verified ? "1" : "0");
  if (filter.exam) params.set("exam", filter.exam);
  if (filter.block) params.set("block", filter.block);
  if (filter.q) params.set("q", filter.q);

  return useInfiniteQuery({
    queryKey: ["topik", "questions", profileId, filter],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams(params);
      qs.set("offset", String(pageParam));
      return api("GET", `/topik/questions?${qs}`, topikQuestionPageSchema);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, p) => n + p.questions.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
}

export const useTopikFacets = (profileId: string, verified?: boolean) =>
  useQuery({
    queryKey: ["topik", "facets", profileId, verified],
    queryFn: () =>
      api(
        "GET",
        `/topik/questions/facets?profile_id=${profileId}${verified === undefined ? "" : `&verified=${verified ? "1" : "0"}`}`,
        topikFacetsSchema,
      ),
  });

function useTopikMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["topik"] }) });
}

export const useCreateTopikQuestion = () =>
  useTopikMutation((vars: TopikQuestionInput & { profile_id: string }) =>
    api("POST", "/topik/questions", topikQuestionSchema, vars),
  );

export const useUpdateTopikQuestion = () =>
  useTopikMutation(({ id, profile_id, patch }: { id: string; profile_id: string; patch: TopikQuestionUpdate }) =>
    api("PATCH", `/topik/questions/${id}`, topikQuestionSchema, { ...patch, profile_id }),
  );

export const useDeleteTopikQuestion = () =>
  useTopikMutation(({ id, profile_id }: { id: string; profile_id: string }) =>
    api("DELETE", `/topik/questions/${id}`, null, { profile_id }),
  );

export const useVerifyTopikBulk = () =>
  useTopikMutation((vars: TopikVerifyBulkRequest & { profile_id: string }) =>
    api("POST", "/topik/questions/verify-bulk", topikVerifyBulkResponseSchema, vars),
  );

export const useUploadTopikImage = () =>
  useMutation({
    mutationFn: ({ profileId, blob }: { profileId: string; blob: Blob }) =>
      apiUpload(`/topik/questions/upload-image?profile_id=${encodeURIComponent(profileId)}`, blob, topikImageUploadResponseSchema),
  });
