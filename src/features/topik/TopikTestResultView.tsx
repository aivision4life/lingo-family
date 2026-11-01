import { Check, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TopikTestResult } from "@shared/topik";
import { LinkButton } from "@/components/LinkButton";
import { Button } from "@/components/ui/button";
import { playSegment, stopAudio, useAudioPlayer } from "@/features/audio/player";
import { formatDuration } from "./segmentEdit";
import { useTopikQuestionContent } from "./api";
import { cn } from "@/lib/utils";

/** Full marks for a real TOPIK II paper; only then does a /100 score mean what it says. */
const FULL_PAPER_QUESTIONS = 50;

/**
 * The result of a sitting (M6.4): the score, how it was sat, and every question.
 *
 * The score is reported **raw** — "18/24 điểm" — and only converted to /100 for a complete
 * 50-question paper. A number that looks like a real TOPIK score but was scaled up from 12
 * questions would be worse than no number at all.
 */
export function TopikTestResultView({ result, profileId }: { result: TopikTestResult; profileId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const fullPaper = result.question_count === FULL_PAPER_QUESTIONS;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-1 rounded-lg border p-4">
        <p className="text-3xl font-bold">
          {fullPaper
            ? t("topik.test.scoreOutOf100", { score: result.score_points })
            : t("topik.test.scoreRaw", { score: result.score_points, total: result.total_points })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("topik.test.correctCount", { correct: result.correct_count, total: result.question_count })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("topik.test.tookTime", { time: formatDuration(result.duration_ms ?? 0) })}
        </p>
        {result.pause_count > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-500">
            {t("topik.test.pausedSummary", { count: result.pause_count, minutes: Math.round(result.paused_ms / 60_000) })}
          </p>
        )}
      </div>

      <ul className="flex flex-col divide-y rounded-lg border">
        {result.items.map((item) => (
          <li key={item.position} className="flex flex-col">
            <button
              type="button"
              className="flex min-h-11 items-center gap-3 p-3 text-left hover:bg-accent"
              aria-expanded={open === item.position}
              onClick={() => setOpen(open === item.position ? null : item.position)}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  item.is_correct ? "bg-green-600 text-white" : "bg-destructive text-white",
                )}
                aria-hidden
              >
                {item.is_correct ? <Check className="size-4" /> : <X className="size-4" />}
              </span>
              <span className="font-medium">{t("topik.test.itemNumber", { number: item.number })}</span>
              <span className="ml-auto text-sm text-muted-foreground">
                {t("topik.test.itemAnswers", { chosen: item.selected_option ?? "–", correct: item.correct_option })}
              </span>
            </button>
            {open === item.position && <ItemReview item={item} profileId={profileId} />}
          </li>
        ))}
      </ul>

      <LinkButton to="/topik/tests" variant="outline">
        {t("topik.test.backToPicker")}
      </LinkButton>
    </div>
  );
}

/** Now that the paper is over, everything is allowed: the clip, the transcript, the explanation. */
function ItemReview({ item, profileId }: { item: TopikTestResult["items"][number]; profileId: string }) {
  const { t } = useTranslation();
  const { playingKey } = useAudioPlayer();
  const content = useTopikQuestionContent(item.question_id ?? "", profileId, false);

  return (
    <div className="flex flex-col gap-3 border-t bg-muted/30 p-3">
      {item.clip && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => (playingKey ? stopAudio() : playSegment(item.clip!.audio_key, item.clip!.start_ms, item.clip!.end_ms))}
        >
          {t("topik.test.listenAgain")}
        </Button>
      )}
      {item.transcript && (
        <p className="text-sm whitespace-pre-wrap" lang="ko">
          {item.transcript}
        </p>
      )}
      {content.data?.explanation_vi && <p className="text-sm text-muted-foreground">{content.data.explanation_vi}</p>}
    </div>
  );
}
