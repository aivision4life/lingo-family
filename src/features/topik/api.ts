import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  topikAttemptResultSchema,
  topikBlockListSchema,
  topikImageUploadResponseSchema,
  topikQuestionListSchema,
  topikQuestionSchema,
  topikSessionResponseSchema,
  topikVerifyBulkResponseSchema,
  type TopikQuestionInput,
  type TopikQuestionUpdate,
  type TopikVerifyBulkRequest,
} from "@shared/topik";
import { api, apiUpload } from "@/lib/api";

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

export const useTopikQuestions = (profileId: string, verified?: boolean) =>
  useQuery({
    queryKey: ["topik", "questions", profileId, verified],
    queryFn: () =>
      api(
        "GET",
        `/topik/questions?profile_id=${profileId}${verified === undefined ? "" : `&verified=${verified ? "1" : "0"}`}`,
        topikQuestionListSchema,
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
