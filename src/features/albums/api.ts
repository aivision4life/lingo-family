import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  albumChangedSchema,
  albumCreatedSchema,
  albumListSchema,
  wordAlbumsResponseSchema,
} from "@shared/album";
import type { LearnLang } from "@shared/enums";
import { api } from "@/lib/api";

const ALBUMS_KEY = ["albums"] as const;

export function useAlbums(lang?: LearnLang | null) {
  return useQuery({
    queryKey: [...ALBUMS_KEY, lang ?? "all"],
    queryFn: () => api("GET", `/albums${lang ? `?lang=${lang}` : ""}`, albumListSchema),
  });
}

/** Membership changes touch the album grid, word lists, word detail and the review counts. */
const refresh = (qc: QueryClient) =>
  Promise.all(["albums", "words", "review"].map((key) => qc.invalidateQueries({ queryKey: [key] })));

export function useCreateAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { profileId: string; name: string; lang: LearnLang }) =>
      api("POST", "/albums", albumCreatedSchema, { profile_id: v.profileId, name: v.name, lang: v.lang }),
    onSuccess: () => refresh(qc),
  });
}

export function useRenameAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { profileId: string; id: string; name: string }) =>
      api("PATCH", `/albums/${v.id}`, albumCreatedSchema, { profile_id: v.profileId, name: v.name }),
    onSuccess: () => refresh(qc),
  });
}

export function useDeleteAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { profileId: string; id: string }) => api("DELETE", `/albums/${v.id}`, null, { profile_id: v.profileId }),
    onSuccess: () => refresh(qc),
  });
}

type Members = { profileId: string; albumId: string; wordIds: string[] };

export function useAddToAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Members) =>
      api("POST", `/albums/${v.albumId}/words`, albumChangedSchema, { profile_id: v.profileId, word_ids: v.wordIds }),
    onSuccess: () => refresh(qc),
  });
}

export function useRemoveFromAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Members) =>
      api("DELETE", `/albums/${v.albumId}/words`, albumChangedSchema, { profile_id: v.profileId, word_ids: v.wordIds }),
    onSuccess: () => refresh(qc),
  });
}

/** Word detail: replaces the set of albums the word belongs to. */
export function useSetWordAlbums(wordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { profileId: string; albumIds: string[] }) =>
      api("PUT", `/words/${wordId}/albums`, wordAlbumsResponseSchema, { profile_id: v.profileId, album_ids: v.albumIds }),
    onSuccess: () => refresh(qc),
  });
}

/** Error codes of the album API → i18n keys (undefined = show the generic message). */
export function albumErrorKey(error: unknown): "albums.errors.duplicate" | "albums.errors.language" | "albums.errors.generic" {
  const body = error && typeof error === "object" && "body" in error ? error.body : null;
  const code = z.object({ error: z.string() }).safeParse(body);
  if (code.success && code.data.error === "duplicate_album") return "albums.errors.duplicate";
  if (code.success && code.data.error === "album_language_mismatch") return "albums.errors.language";
  return "albums.errors.generic";
}
