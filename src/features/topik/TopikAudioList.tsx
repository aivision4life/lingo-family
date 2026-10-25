import { useTranslation } from "react-i18next";
import type { TopikAudioSummary } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { formatTimeInput } from "./segmentEdit";
import { useTopikAudioList } from "./api";

/** The listening papers that have audio, with how far each is from being usable (M7.1). */
export function TopikAudioList({ profileId, onOpen }: { profileId: string; onOpen: (audio: TopikAudioSummary) => void }) {
  const { t } = useTranslation();
  const list = useTopikAudioList(profileId);

  if (list.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (list.isError) return <p className="text-destructive">{t("common.loadError")}</p>;
  if (list.data.length === 0) return <p className="text-muted-foreground">{t("topik.audio.empty")}</p>;

  return (
    <ul className="flex flex-col gap-2">
      {list.data.map((audio) => (
        <li key={audio.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">{audio.exam}</span>
            <span className="text-sm text-muted-foreground">
              {t("topik.audio.listLine", {
                segments: audio.segment_count,
                questions: audio.question_count,
                duration: formatTimeInput(audio.duration_ms),
              })}
            </span>
            <span className={audio.verified ? "text-sm text-muted-foreground" : "text-sm text-amber-700 dark:text-amber-500"}>
              {t(audio.verified ? "topik.audio.approved" : "topik.audio.notApproved")}
              {audio.unassigned_questions > 0 && ` · ${t("topik.audio.unassigned", { count: audio.unassigned_questions })}`}
            </span>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onOpen(audio)}>
            {t("topik.audio.edit")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
