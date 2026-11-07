import { z } from "zod";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  topikAttemptResultSchema,
  topikGroupRevealSchema,
  topikAudioListSchema,
  topikAudioSchema,
  topikBlockListSchema,
  topikFacetsSchema,
  topikGenerateContentResponseSchema,
  topikImageUploadResponseSchema,
  topikQuestionContentSchema,
  topikQuestionPageSchema,
  topikQuestionSchema,
  topikQuestionStatsSchema,
  topikSessionResponseSchema,
  topikVerifyBulkResponseSchema,
  type TopikQuestionInput,
  type TopikQuestionUpdate,
  type TopikSegmentUpdate,
  topikTestOptionsSchema,
  topikTestResultSchema,
  topikTestRunSchema,
  type TopikSessionMode,
  type TopikTestCreate,
  type TopikTestFinish,
  type TopikVerifyBulkRequest,
} from "@shared/topik";
import type { TopikSection } from "@shared/enums";
import { api, apiUpload } from "@/lib/api";

/** How often the practice/review screens re-check `GET .../content` while something is still
 * being generated in the background (M6.4-ish) — same cadence as the images feature's own polling. */
const CONTENT_POLL_MS = 3000;

/** Pages of 30; the review screen (M6.1+, filters/search added as the bank grows past ~600 rows)
 * loads more as the adult scrolls/taps "Tải thêm" instead of fetching everything at once. */
const TOPIK_MANAGE_PAGE_SIZE = 30;

export type TopikQuestionFilter = { section?: TopikSection; verified?: boolean; exam?: string; block?: string; q?: string };

/** `profileId` decides the per-block "not studied yet" count, so it is part of the cache key. */
export const useTopikBlocks = (profileId: string, section: TopikSection) =>
  useQuery({
    queryKey: ["topik", "blocks", profileId, section],
    queryFn: () => api("GET", `/topik/blocks?section=${section}&profile_id=${profileId}`, topikBlockListSchema),
    enabled: profileId !== "",
  });

/**
 * The questions of one practice session.
 *
 * Fetched **once** and never refetched while the session is on screen, the same way the review
 * queue is: every call to `/topik/session` builds a brand-new session from whatever is due at that
 * moment, so a refetch would swap the questions out from under the learner. Locking the phone and
 * coming back used to do exactly that (the default `staleTime: 0` + refetch on window focus), and
 * the progress of the session in hand was lost.
 */
export const useTopikSession = (profileId: string, section: TopikSection, from: number, to: number, mode: TopikSessionMode = "due") =>
  useQuery({
    queryKey: ["topik", "session", profileId, section, from, to, mode],
    queryFn: () =>
      api("GET", `/topik/session?profile_id=${profileId}&section=${section}&from=${from}&to=${to}&mode=${mode}`, topikSessionResponseSchema),
    enabled: from > 0 && to > 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

export const useSubmitTopikAttempt = () =>
  useMutation({
    mutationFn: (body: {
      profile_id: string;
      question_id: string;
      selected_option: number;
      duration_ms: number;
      /** false in a practise-anyway session: recorded, but the FSRS schedule is left alone. */
      schedule?: boolean;
      /** True while another question about the same recording is unanswered: the server then
       * withholds the transcript and the explanation, which would answer that one too (M7.5). */
      group_pending?: boolean;
    }) => api("POST", "/topik/attempts", topikAttemptResultSchema, body),
  });

/** Giving up on a group to read its transcript instead (M7.5). Writes nothing on the server. */
export const useRevealTopikGroup = () =>
  useMutation({
    mutationFn: ({ question_id, profile_id }: { question_id: string; profile_id: string }) =>
      api("GET", `/topik/questions/${question_id}/reveal?profile_id=${profile_id}`, topikGroupRevealSchema),
  });

/** Polls one question's current vocab/explanation (M6.4-ish): used while a practice session's
 * background generation hasn't finished yet, or after the review screen's "Tạo dữ liệu AI". Stops
 * polling as soon as the caller passes `enabled: false` (typically once both are ready). */
/**
 * A question's vocabulary and explanation.
 *
 * `poll` is what a screen waiting for generation needs (practice, the review list): it asks again
 * every few seconds until the data lands. Reading a finished paper only needs the data once, so
 * it passes `poll: false` — fetching it, but not every three seconds for fifty questions.
 */
export const useTopikQuestionContent = (questionId: string, profileId: string, { enabled = true, poll = false } = {}) =>
  useQuery({
    queryKey: ["topik", "content", questionId, profileId],
    queryFn: () =>
      api("GET", `/topik/questions/${questionId}/content?profile_id=${encodeURIComponent(profileId)}`, topikQuestionContentSchema),
    enabled: enabled && questionId !== "",
    refetchInterval: enabled && poll ? CONTENT_POLL_MS : false,
  });

/** Review screen's per-question "Tạo dữ liệu AI": starts background generation for whichever of
 * vocab/explanation this one question is still missing. */
export const useGenerateTopikContent = () =>
  useMutation({
    mutationFn: ({ id, profileId }: { id: string; profileId: string }) =>
      api("POST", `/topik/questions/${id}/generate-content`, topikGenerateContentResponseSchema, { profile_id: profileId }),
  });

/** One profile's own full history ("7/10 đúng") on one question — shown small on the practice
 * screen, never a spoiler. Invalidated after submitting an attempt so it updates right away. */
export const useTopikQuestionStats = (questionId: string, profileId: string) =>
  useQuery({
    queryKey: ["topik", "stats", questionId, profileId],
    queryFn: () => api("GET", `/topik/questions/${questionId}/stats?profile_id=${encodeURIComponent(profileId)}`, topikQuestionStatsSchema),
    enabled: !!questionId,
  });

// --- Management (adults only) -------------------------------------------------------------------

export function useTopikQuestionsPaged(profileId: string, filter: TopikQuestionFilter) {
  const params = new URLSearchParams({ profile_id: profileId, limit: String(TOPIK_MANAGE_PAGE_SIZE) });
  if (filter.section) params.set("section", filter.section);
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

export const useTopikFacets = (profileId: string, section: TopikSection, verified?: boolean) =>
  useQuery({
    queryKey: ["topik", "facets", profileId, section, verified],
    queryFn: () =>
      api(
        "GET",
        `/topik/questions/facets?profile_id=${profileId}&section=${section}${verified === undefined ? "" : `&verified=${verified ? "1" : "0"}`}`,
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

// --- Listening audio (M7.1, adults only) -------------------------------------------------------

export const useTopikAudioList = (profileId: string) =>
  useQuery({
    queryKey: ["topik", "audio", profileId],
    queryFn: () => api("GET", `/topik/audio?profile_id=${profileId}`, topikAudioListSchema),
    enabled: profileId !== "",
  });

export const useTopikAudio = (id: string, profileId: string) =>
  useQuery({
    queryKey: ["topik", "audio", profileId, id],
    queryFn: () => api("GET", `/topik/audio/${id}?profile_id=${profileId}`, topikAudioSchema),
    enabled: id !== "" && profileId !== "",
  });

/** Every mutation here invalidates the whole audio tree: a boundary edit also un-approves the exam. */
const useAudioMutation = <TVariables>(run: (v: TVariables) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["topik"] }),
  });
};

export const useUpdateTopikSegment = () =>
  useAudioMutation(({ id, profile_id, patch }: { id: string; profile_id: string; patch: TopikSegmentUpdate }) =>
    api("PATCH", `/topik/segments/${id}`, null, { ...patch, profile_id }),
  );

export const useSetQuestionSegment = () =>
  useAudioMutation(({ id, profile_id, segment_id }: { id: string; profile_id: string; segment_id: string | null }) =>
    api("PATCH", `/topik/questions/${id}/segment`, topikQuestionSchema, { segment_id, profile_id }),
  );

export const useVerifyTopikAudio = () =>
  useAudioMutation(({ id, profile_id, verified }: { id: string; profile_id: string; verified: boolean }) =>
    api("PATCH", `/topik/audio/${id}`, null, { verified, profile_id }),
  );

// --- Mock test (M6.4) ---------------------------------------------------------------------------

export const useTopikTestOptions = (profileId: string, section: TopikSection) =>
  useQuery({
    queryKey: ["topik", "tests", "options", profileId, section],
    queryFn: () => api("GET", `/topik/tests/options?profile_id=${profileId}&section=${section}`, topikTestOptionsSchema),
    enabled: profileId !== "",
  });

export const useCreateTopikTest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TopikTestCreate) => api("POST", "/topik/tests", topikTestRunSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["topik", "tests"] }),
  });
};

/** A running sitting, or a finished one's result — the server decides which shape by its status. */
export const useTopikTest = (testId: string, profileId: string) =>
  useQuery({
    queryKey: ["topik", "tests", testId, profileId],
    queryFn: () => api("GET", `/topik/tests/${testId}?profile_id=${profileId}`, topikTestRunSchema.or(topikTestResultSchema)),
    enabled: testId !== "" && profileId !== "",
  });

/**
 * Saves one answer. Deliberately **not** wired to any loading state: the tape does not stop for
 * the network, so a failure here is swallowed by the caller and replayed at `finish`.
 */
export const useSaveTopikTestAnswer = () =>
  useMutation({
    mutationFn: ({ testId, position, ...body }: { testId: string; position: number; profile_id: string; selected_option: number }) =>
      api("PUT", `/topik/tests/${testId}/items/${position}`, z.object({ position: z.number(), selected_option: z.number() }), body),
  });

export const useFinishTopikTest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ testId, ...body }: TopikTestFinish & { testId: string }) =>
      api("POST", `/topik/tests/${testId}/finish`, topikTestResultSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["topik"] }),
  });
};

export const useAbandonTopikTest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ testId, profile_id }: { testId: string; profile_id: string }) =>
      api("POST", `/topik/tests/${testId}/abandon`, z.object({ id: z.string(), status: z.string() }), { profile_id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["topik", "tests"] }),
  });
};
