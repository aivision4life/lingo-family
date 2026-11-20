import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, SkipForward, TriangleAlert } from "lucide-react";
import type { PodcastPlaylist } from "@shared/podcast";
import { Button } from "@/components/ui/button";
import { PodcastRatePicker } from "./PodcastRatePicker";
import { addSkip, describeSkip, type PodcastSkip } from "./podcastSkips";
import { useMixedTape } from "./useMixedTape";
import { buildPodcastTape, nextQuestionStart, podcastPositionAt } from "./podcastTape";

/**
 * The podcast itself (SPEC F13, M8.1): the same two-element tape the mixed sitting uses, with a
 * different playlist and different labels — F13 says not to write a second player, so this is the
 * screen around the one there is.
 *
 * Plain on purpose. M8.1 proves the shape; the lock screen, the car and offline are M8.2, and
 * until those exist this screen is something to look at once and then put in a pocket.
 */
export function PodcastPlayer({ playlist, onLeave }: { playlist: PodcastPlaylist; onLeave: () => void }) {
  const { t } = useTranslation();
  const tape = useMemo(() => buildPodcastTape(playlist), [playlist]);
  const player = useMixedTape();
  const [started, setStarted] = useState(false);
  // Kept for the rest of the sitting, not flashed and lost: a piece that could not be played is
  // the one thing the owner has to be able to photograph and send.
  const [skips, setSkips] = useState<PodcastSkip[]>([]);
  const position = podcastPositionAt(tape, player.index);
  const question = playlist.questions[position.question];
  const next = nextQuestionStart(tape, player.index);

  // Leaving the screen stops the sound; the hook disposes the tape, this stops it being heard
  // for the fraction of a second before that happens on a slow phone.
  useEffect(() => () => player.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!question) return null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {t("topik.podcast.progress", { current: position.question + 1, total: playlist.questions.length })} · {question.exam}
        </p>
        <h2 className="text-lg font-semibold">{t("topik.podcast.questionNumber", { n: question.number })}</h2>
        <p lang="ko" className="text-base">
          {question.question_line}
        </p>
        <p className="text-sm text-muted-foreground">{t(`topik.podcast.step.${position.step}`)}</p>
        {player.waiting && <p className="text-sm text-amber-700 dark:text-amber-500">{t("topik.podcast.buffering")}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="lg"
          // Straight from the tap: both <audio> elements must unlock while the gesture is live.
          onClick={() => {
            if (!started) {
              setStarted(true);
              void player.start(tape.tracks, (e) => {
                if (e.kind !== "skipped") return;
                const skip = describeSkip(tape, playlist.questions, e);
                if (skip) setSkips((s) => addSkip(s, skip));
              });
            } else {
              player.toggle();
            }
          }}
        >
          {started && player.playing ? <Pause /> : <Play />}
          {started && player.playing ? t("topik.podcast.pause") : started ? t("topik.podcast.resume") : t("topik.podcast.play")}
        </Button>
        <Button type="button" size="lg" variant="outline" disabled={!started || next === null} onClick={() => next !== null && player.jumpTo(next)}>
          <SkipForward />
          {t("topik.podcast.next")}
        </Button>
        <Button type="button" size="lg" variant="ghost" onClick={onLeave}>
          {t("topik.podcast.change")}
        </Button>
      </div>

      {skips.length > 0 && (
        <ul className="flex flex-col gap-1">
          {skips.map((skip) => (
            <li key={skip.index} className="flex items-start gap-1 text-sm text-amber-700 dark:text-amber-500">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t("topik.podcast.skippedTrack", {
                  what: t(`topik.podcast.part.${skip.step}`),
                  n: skip.number,
                  reason: t(`topik.podcast.reason.${skip.reason}`),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      <PodcastRatePicker />

      {player.finished && <p className="text-sm">{t("topik.podcast.finished")}</p>}
    </section>
  );
}
