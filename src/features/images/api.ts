import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  backfillResponseSchema,
  backfillStatusSchema,
  IMAGE_STALE_MS,
  imageStateSchema,
  usageSchema,
  type ImageItemKind,
  type ImageView,
} from "@shared/image";
import { api, apiUpload } from "@/lib/api";

export const imageUrl = (key: string) => `/api/media/${key}`;

type Item = { kind: ImageItemKind; id: string };

/** Lists that show images (words, phrases) are refreshed after any image change. */
const invalidateImages = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ["words"] }),
    qc.invalidateQueries({ queryKey: ["phrases"] }),
    qc.invalidateQueries({ queryKey: ["usage"] }),
  ]);

const post = (item: Item, action: "ensure" | "retry" | "redraw", body: object) =>
  api("POST", `/images/${item.kind}/${item.id}/${action}`, imageStateSchema, body);

/** Lazy example image / take-over of a stalled drawing (any profile). */
export function useEnsureImage(item: Item) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => post(item, "ensure", { profile_id: profileId }),
    onSuccess: () => invalidateImages(qc),
  });
}

/** Adults: "Try again", "Redraw" (edited prompt) and "My photo". */
export function useImageActions(item: Item) {
  const qc = useQueryClient();
  const onSuccess = () => invalidateImages(qc);
  return {
    retry: useMutation({ mutationFn: (profileId: string) => post(item, "retry", { profile_id: profileId }), onSuccess }),
    redraw: useMutation({
      mutationFn: (v: { profileId: string; prompt: string }) =>
        post(item, "redraw", { profile_id: v.profileId, image_prompt: v.prompt }),
      onSuccess,
    }),
    upload: useMutation({
      mutationFn: (v: { profileId: string; blob: Blob }) =>
        apiUpload(`/images/${item.kind}/${item.id}/upload?profile_id=${encodeURIComponent(v.profileId)}`, v.blob, imageStateSchema),
      onSuccess,
    }),
  };
}

export function useUsage(profileId: string | undefined) {
  return useQuery({
    queryKey: ["usage", profileId],
    queryFn: () => api("GET", `/usage?profile_id=${encodeURIComponent(profileId!)}`, usageSchema),
    enabled: !!profileId,
  });
}

export function useBackfillStatus() {
  return useQuery({ queryKey: ["usage", "backfill"], queryFn: () => api("GET", "/images/backfill/status", backfillStatusSchema) });
}

/** One backfill step (one old word). The Settings card calls it repeatedly. */
export const backfillStep = (profileId: string) =>
  api("POST", "/images/backfill", backfillResponseSchema, { profile_id: profileId });

// --- Polling while images are being drawn -----------------------------------------

/** Pending and claimed recently: worth polling for (stalled ones are taken over by ItemImage). */
export const isFreshPending = (img: ImageView, now = Date.now()) =>
  img.image_status === "pending" && img.image_requested_at !== null && now - img.image_requested_at < IMAGE_STALE_MS + 60_000;

export const isStalePending = (img: ImageView, now = Date.now()) =>
  img.image_status === "pending" && (img.image_requested_at === null || now - img.image_requested_at >= IMAGE_STALE_MS);

/** `refetchInterval` for queries that contain images: every 3 s while something is being drawn. */
export const POLL_MS = 3000;
export const pollWhilePending =
  <T>(images: (data: T) => ImageView[]) =>
  (query: { state: { data: T | undefined } }) =>
    query.state.data !== undefined && images(query.state.data).some((img) => isFreshPending(img)) ? POLL_MS : false;
