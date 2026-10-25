import { Check, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { stopAudio } from "@/features/audio/player";
import { formatTimeInput } from "./segmentEdit";
import { useTopikAudio, useUpdateTopikSegment, useVerifyTopikAudio } from "./api";
import { canApprove, segmentProblems } from "./segmentEdit";
import { TopikSegmentRow } from "./TopikSegmentRow";

/**
 * Screen (M7.1) — review one listening paper's clip boundaries before its questions may be
 * practised. The mp3 is never modified: every edit here moves timestamps in the database, so a
 * boundary can be corrected as often as it takes without re-uploading 30 MB.
 *
 * Approval is blocked while anything is wrong with the clips, because those mistakes cannot be
 * heard: an overlap or a gap still plays normal audio, and the learner simply hears the wrong part
 * of the paper, which surfaces only as answers that stop making sense.
 */
export function TopikAudioEditor({ audioId, profileId, onBack }: { audioId: string; profileId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const audio = useTopikAudio(audioId, profileId);
  const updateSegment = useUpdateTopikSegment();
  const verify = useVerifyTopikAudio();

  if (audio.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (audio.isError) return <p className="text-destructive">{t("common.loadError")}</p>;

  const { segments, duration_ms, verified, exam, audio_key, unassigned_questions } = audio.data;
  const problems = segmentProblems(segments, duration_ms);
  const problemsOf = (id: string) => problems.filter((p) => p.segmentId === id);
  const ready = canApprove(segments, duration_ms) && unassigned_questions === 0;

  const back = () => {
    stopAudio();
    onBack();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{exam}</h2>
        <p className="text-sm text-muted-foreground">
          {t("topik.audio.summary", { count: segments.length, duration: formatTimeInput(duration_ms) })}
        </p>
        {unassigned_questions > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-500">{t("topik.audio.unassigned", { count: unassigned_questions })}</p>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            {verified ? <Check className="size-4 text-green-700 dark:text-green-400" aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
            {t(verified ? "topik.audio.approved" : "topik.audio.notApproved")}
          </span>
          <Button
            type="button"
            size="sm"
            variant={verified ? "outline" : "default"}
            disabled={verify.isPending || (!verified && !ready)}
            onClick={() => verify.mutate({ id: audioId, profile_id: profileId, verified: !verified })}
          >
            {t(verified ? "topik.audio.unapprove" : "topik.audio.approve")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(verified ? "topik.audio.approvedHint" : ready ? "topik.audio.readyHint" : "topik.audio.blockedHint")}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {segments.map((segment) => (
          <TopikSegmentRow
            key={segment.id}
            segment={segment}
            audioKey={audio_key}
            problems={problemsOf(segment.id)}
            saving={updateSegment.isPending}
            onChange={(patch) => updateSegment.mutate({ id: segment.id, profile_id: profileId, patch })}
          />
        ))}
      </ul>

      <Button type="button" variant="ghost" onClick={back}>
        {t("common.back")}
      </Button>
    </div>
  );
}
