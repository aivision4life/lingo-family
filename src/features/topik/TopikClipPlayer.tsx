import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TopikClip } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { PLAYBACK_RATES, playSegment, stopAudio, useAudioPlayer } from "@/features/audio/player";
import { practiceEnd } from "./segmentEdit";

/**
 * The listening half of a question (M7.1): the clip is played, never read. The paper's own mp3 is
 * one ~30 MB file for the whole exam, so playback asks the server for just this clip's bytes.
 *
 * Playback stops shortly after the talking rather than at the exam's own boundary: the paper leaves
 * ~18 seconds to answer, and in self-paced practice that is 18 seconds of dead air — the learner
 * takes as long as they like anyway. The real boundary is kept for the timed mock test. A clip that
 * carries two questions is the exception and plays whole; `practiceEnd` says why.
 *
 * Replays are unlimited on purpose. This is practice, not the exam; a learner who needs to hear a
 * dialogue four times is doing exactly what practice is for.
 */
export function TopikClipPlayer({ clip, questionId, questionCount = 1 }: { clip: TopikClip; questionId: string; questionCount?: number }) {
  const { t } = useTranslation();
  const { playingKey, rate, setRate } = useAudioPlayer();
  const playing = playingKey !== null;
  const play = () => playSegment(clip.audio_key, clip.start_ms, practiceEnd(clip, questionCount));

  // Each question starts by playing its clip once, and leaving the question stops the sound —
  // otherwise the previous clip keeps talking over the next question.
  useEffect(() => {
    play();
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one play per question, by id
  }, [questionId]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border p-6">
      <Button type="button" size="lg" variant={playing ? "secondary" : "default"} className="min-w-44" onClick={() => (playing ? stopAudio() : play())}>
        {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
        {t(playing ? "topik.practice.stopAudio" : "topik.practice.playAudio")}
      </Button>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={play}>
          <RotateCcw className="size-4" aria-hidden />
          {t("topik.practice.replay")}
        </Button>
        {PLAYBACK_RATES.map((r) => (
          <Button key={r} type="button" size="sm" variant={rate === r ? "default" : "outline"} onClick={() => setRate(r)}>
            {r}×
          </Button>
        ))}
      </div>
    </div>
  );
}
