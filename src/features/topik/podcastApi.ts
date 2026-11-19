import { useQuery } from "@tanstack/react-query";
import { podcastPapersSchema, podcastPlaylistSchema } from "@shared/podcast";
import { api } from "@/lib/api";

/** The papers a podcast can be built from (SPEC F13, M8.1). */
export const usePodcastPapers = (profileId: string) =>
  useQuery({
    queryKey: ["topik", "podcast", "papers", profileId],
    queryFn: () => api("GET", `/topik/podcast/papers?profile_id=${profileId}`, podcastPapersSchema),
    enabled: profileId !== "",
  });

/**
 * The playlist for a selection — read by the picker to say what it really holds, and then played
 * as it stands. One request for both, because counts from one decision and a tape from another
 * would eventually disagree about something.
 */
export const usePodcastPlaylist = (profileId: string, exam: string | null, from: number, to: number, enabled: boolean) =>
  useQuery({
    queryKey: ["topik", "podcast", profileId, exam, from, to],
    queryFn: () => {
      const qs = new URLSearchParams({ profile_id: profileId, from: String(from), to: String(to) });
      if (exam) qs.set("exam", exam);
      return api("GET", `/topik/podcast?${qs}`, podcastPlaylistSchema);
    },
    enabled: enabled && profileId !== "",
  });
