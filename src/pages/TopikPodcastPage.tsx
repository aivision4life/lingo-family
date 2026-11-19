import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PodcastPlaylist } from "@shared/podcast";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { PodcastPlayer } from "@/features/topik/PodcastPlayer";
import { RangeInputs } from "@/features/topik/RangeInputs";
import { usePodcastPapers, usePodcastPlaylist } from "@/features/topik/podcastApi";
import { cn } from "@/lib/utils";

/**
 * Screen — `/topik/podcast` (SPEC F13, M8.1): the listening paper with the ears alone.
 *
 * The picker's whole job is to be honest about what the set will really contain. Three things
 * quietly shrink it, and every one of them is counted on the screen before anything plays:
 * questions 1-3 answer with pictures, a question may have no TTS generated yet, and across every
 * paper a question nobody has answered is kept back for a mock test (M7.27) — this is the screen
 * where that rule bites hardest, because a podcast reads the answer out loud.
 */
export function TopikPodcastPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  // Kid profiles are kept out of TOPIK II everywhere else (SPEC §10) and this is no different:
  // the podcast reads the answers out, which is the adults' exam practice, not a child's.
  const profileId = canManageProfiles(profile) ? (profile?.id ?? "") : "";
  const papers = usePodcastPapers(profileId);
  const [exam, setExam] = useState<string | null>(null);
  const maxNumber = Math.max(1, papers.data?.max_number ?? 50);
  const [range, setRange] = useState({ from: 4, to: 50, valid: true });
  const [playing, setPlaying] = useState<PodcastPlaylist | null>(null);
  const preview = usePodcastPlaylist(profileId, exam, range.from, range.to, range.valid);
  const playlist = preview.data ?? null;

  if (!profile) return null;
  if (!canManageProfiles(profile)) {
    return (
      <PageShell title={t("topik.podcast.title")}>
        <p>{t("topik.kidNotAllowed")}</p>
      </PageShell>
    );
  }
  if (playing) return <PageShell title={t("topik.podcast.title")}><PodcastPlayer playlist={playing} onLeave={() => setPlaying(null)} /></PageShell>;

  const skipped = playlist?.skipped;
  return (
    <PageShell title={t("topik.podcast.title")}>
      <p className="text-sm text-muted-foreground">{t("topik.podcast.intro")}</p>
      {/* Said before anything is chosen, not discovered afterwards as three missing questions. */}
      <p className="text-sm text-muted-foreground">{t("topik.podcast.firstThree")}</p>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-semibold">{t("topik.podcast.paperTitle")}</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={exam === null ? "default" : "outline"} onClick={() => setExam(null)}>
            {t("topik.podcast.allPapers")}
          </Button>
          {(papers.data?.papers ?? []).map((p) => (
            <Button key={p.exam} type="button" variant={exam === p.exam ? "default" : "outline"} onClick={() => setExam(p.exam)}>
              <span lang="ko">{p.exam}</span>
            </Button>
          ))}
        </div>
        {exam === null && <p className="text-sm text-muted-foreground">{t("topik.podcast.allPapersHint")}</p>}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <h2 className="font-semibold">{t("topik.picker.rangeTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("topik.podcast.rangeHint")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <RangeInputs maxNumber={maxNumber} value={range} onChange={setRange} />
          <Button
            type="button"
            size="lg"
            disabled={!range.valid || playlist === null || playlist.questions.length === 0}
            onClick={() => playlist && setPlaying(playlist)}
          >
            {t("topik.podcast.start")}
          </Button>
        </div>

        {playlist !== null && (
          <div className="flex flex-col gap-1 text-sm">
            {playlist.expanded && (
              <p className="text-amber-700 dark:text-amber-500">{t("topik.podcast.widened", { from: playlist.from, to: playlist.to })}</p>
            )}
            <p className={cn(playlist.questions.length === 0 && "text-destructive")}>
              {t("topik.podcast.count", { count: playlist.questions.length })}
            </p>
            {/* Every question the selection covered but the tape leaves out, and why. */}
            {skipped && skipped.picture_options > 0 && <p className="text-muted-foreground">{t("topik.podcast.skippedPictures", { count: skipped.picture_options })}</p>}
            {skipped && skipped.no_clip > 0 && <p className="text-muted-foreground">{t("topik.podcast.skippedNoClip", { count: skipped.no_clip })}</p>}
            {skipped && skipped.reserved_for_tests > 0 && (
              <p className="text-muted-foreground">{t("topik.podcast.skippedReserved", { count: skipped.reserved_for_tests })}</p>
            )}
            {skipped && skipped.no_tts > 0 && <p className="text-destructive">{t("topik.podcast.skippedNoTts", { count: skipped.no_tts })}</p>}
          </div>
        )}
      </section>
    </PageShell>
  );
}
