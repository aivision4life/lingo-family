import { Loader2, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TopikClip } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { PLAYBACK_RATES, playbackPhase, playSegment, stopAudio, useAudioPlayer } from "@/features/audio/player";
import { announcedQuestion, announcementStart, clipProgress, formatDuration, practiceEnd } from "./segmentEdit";

/**
 * The listening half of a question (M7.1): the clip is played, never read. The paper's own mp3 is
 * one ~30 MB file for the whole exam, so playback asks the server for just this clip's bytes.
 *
 * Playback stops shortly after the talking rather than at the exam's own boundary: the paper leaves
 * ~18 seconds to answer, and in self-paced practice that is 18 seconds of dead air — the learner
 * takes as long as they like anyway. The real boundary is kept for the timed mock test. A clip that
 * carries two questions is **not** an exception: it stops at `practiceEnd` like every other clip,
 * and is never played whole (this comment used to say it was; the code never did). What that
 * window contains for a pair is written on `practiceEnd`.
 *
 * A pair's window holds the first question's own answer pause — 10 to 20 seconds of silence before
 * the second question is announced. Two things make that silence honest instead of looking like a
 * stop: the progress bar keeps moving through it (the tape IS running), and "go to question N"
 * jumps to just before the announcement for whoever does not want to wait.
 *
 * The big button shows one of four phases (`playbackPhase`), never just "playing or not": while
 * the clip is on its way it says so and cannot be tapped — a second tap there used to restart the
 * clip from the top — and a load that failed says it failed. Replay and the jump wait as well.
 * The small buttons are full-height (44 px): they are tapped mid-listening, on a phone, and a
 * missed tap is exactly how the wrong thing gets pressed.
 *
 * Replays are unlimited on purpose. This is practice, not the exam; a learner who needs to hear a
 * dialogue four times is doing exactly what practice is for.
 */
export function TopikClipPlayer({ clip, questionId, numbers }: { clip: TopikClip; questionId: string; numbers: readonly number[] }) {
  const { t } = useTranslation();
  const player = useAudioPlayer();
  const { clip: running, rate, setRate } = player;
  const phase = playbackPhase(player);
  const playing = phase === "playing";
  const loading = phase === "loading";
  const end = practiceEnd(clip);
  const play = (fromMs?: number) => playSegment(clip.audio_key, clip.start_ms, end, fromMs);
  const next = announcedQuestion(numbers);
  // While nothing plays the bar is empty, and the clock still says how long the window is.
  const positionMs = running?.key === clip.audio_key ? running.positionMs : clip.start_ms;

  // Each question starts by playing its clip once, and leaving the question stops the sound —
  // otherwise the previous clip keeps talking over the next question.
  useEffect(() => {
    play();
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one play per question, by id
  }, [questionId]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border p-6">
      <Button
        type="button"
        size="lg"
        variant={playing || loading ? "secondary" : "default"}
        className="min-w-44"
        disabled={loading}
        onClick={() => (playing ? stopAudio() : play())}
      >
        {loading ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : playing ? (
          <Pause className="size-5" aria-hidden />
        ) : (
          <Play className="size-5" aria-hidden />
        )}
        {t(loading ? "topik.practice.loadingAudio" : playing ? "topik.practice.stopAudio" : "topik.practice.playAudio")}
      </Button>
      {phase === "error" && (
        <p role="alert" className="text-center text-sm text-destructive">
          {t("topik.practice.audioError")}
        </p>
      )}

      <div className="flex w-full max-w-sm items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
          <div
            data-slot="clip-progress"
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${clipProgress(positionMs, clip.start_ms, end) * 100}%` }}
          />
        </div>
        <span aria-live="off" className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {t("topik.audio.clock", { at: formatDuration(positionMs - clip.start_ms), total: formatDuration(end - clip.start_ms) })}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" disabled={loading} onClick={() => play()}>
          <RotateCcw className="size-4" aria-hidden />
          {t("topik.practice.replay")}
        </Button>
        {next !== null && (
          <Button type="button" variant="outline" disabled={loading} onClick={() => play(announcementStart(clip))}>
            <SkipForward className="size-4" aria-hidden />
            {t("topik.practice.jumpToQuestion", { n: next })}
          </Button>
        )}
        {PLAYBACK_RATES.map((r) => (
          <Button key={r} type="button" variant={rate === r ? "default" : "outline"} onClick={() => setRate(r)}>
            {r}×
          </Button>
        ))}
      </div>
    </div>
  );
}
