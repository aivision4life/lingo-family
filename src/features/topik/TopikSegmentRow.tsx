import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TopikSegment } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { playSegment, stopAudio, useAudioPlayer } from "@/features/audio/player";
import { cn } from "@/lib/utils";
import {
  clipProgress,
  formatDuration,
  formatTimeInput,
  headPreview,
  metricsOf,
  parseTimeInput,
  practiceEnd,
  PREVIEW_HEAD_MS,
  PREVIEW_TAIL_MS,
  tailPreview,
  type SegmentProblem,
  type SegmentWarning,
} from "./segmentEdit";

type Field = "start_ms" | "speech_end_ms" | "end_ms";
const FIELDS: Field[] = ["start_ms", "speech_end_ms", "end_ms"];
/** How far one tap of the nudge buttons moves a boundary. */
const NUDGES = [-1000, -250, 250, 1000];

type Props = {
  segment: TopikSegment;
  audioKey: string;
  problems: SegmentProblem[];
  warnings: SegmentWarning[];
  saving: boolean;
  onChange: (patch: Partial<Record<Field, number>>) => void;
};

/**
 * One clip of a listening paper: its three timestamps, a listen button for each way of playing it,
 * and the questions asked about it. Editing only ever writes to the database — the mp3 is never
 * touched, so a boundary can be corrected as often as it takes.
 */
export function TopikSegmentRow({ segment, audioKey, problems, warnings, saving, onChange }: Props) {
  const { t } = useTranslation();
  const { playingKey, clip } = useAudioPlayer();
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({});
  const { lengthMs, pauseMs } = metricsOf(segment);
  // Any of this clip's four play buttons, identified by where it starts inside the exam: the two
  // previews start elsewhere in the clip, so the bar follows whichever range is actually playing.
  const running = clip && clip.key === audioKey && clip.startMs >= segment.start_ms && clip.endMs <= segment.end_ms ? clip : null;

  const value = (field: Field) => draft[field] ?? formatTimeInput(segment[field]);
  const invalid = (field: Field) => draft[field] !== undefined && parseTimeInput(draft[field]!) === null;

  const commit = (field: Field) => {
    const text = draft[field];
    setDraft((d) => ({ ...d, [field]: undefined }));
    if (text === undefined) return;
    const ms = parseTimeInput(text);
    if (ms !== null && ms !== segment[field]) onChange({ [field]: ms });
  };

  const nudge = (field: Field, by: number) => onChange({ [field]: Math.max(0, segment[field] + by) });

  // The two ways a clip is heard: what practice plays (talking plus a short pause) and the whole
  // clip as the real paper paces it, which is what the timed mock test will use.
  const play = (to: number) => (playingKey ? stopAudio() : playSegment(audioKey, segment.start_ms, to));
  const playRange = ({ from, to }: { from: number; to: number }) => (playingKey ? stopAudio() : playSegment(audioKey, from, to));

  return (
    <li
      id={`segment-${segment.id}`}
      className={cn(
        "flex scroll-mt-4 flex-col gap-2 rounded-lg border p-3",
        warnings.length > 0 && "border-amber-500",
        problems.length > 0 && "border-destructive",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{t("topik.audio.segmentN", { n: segment.idx })}</span>
        <span className="text-sm text-muted-foreground">
          {segment.questions.length > 0
            ? t("topik.audio.questionsOn", { numbers: segment.questions.map((n) => `#${n}`).join(", ") })
            : t("topik.audio.noQuestion")}
        </span>
      </div>

      <p className="font-mono text-sm tabular-nums text-muted-foreground">
        {t("topik.audio.metrics", { length: formatDuration(lengthMs), pause: formatDuration(pauseMs) })}
      </p>

      {warnings.length > 0 && (
        <ul className="text-sm text-amber-700 dark:text-amber-500">
          {warnings.map((w) => (
            <li key={w.code}>{t(`topik.audio.warning.${w.code}`)}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {FIELDS.map((field) => (
          <div key={field} className="flex flex-wrap items-center gap-2">
            <label className="w-28 shrink-0 text-sm text-muted-foreground" htmlFor={`${segment.id}-${field}`}>
              {t(`topik.audio.field.${field}`)}
            </label>
            <Input
              id={`${segment.id}-${field}`}
              value={value(field)}
              inputMode="decimal"
              aria-invalid={invalid(field)}
              disabled={saving}
              className="w-32 font-mono"
              onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
              onBlur={() => commit(field)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <div className="flex gap-1">
              {NUDGES.map((by) => (
                <Button
                  key={by}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  aria-label={t("topik.audio.nudge", { field: t(`topik.audio.field.${field}`), by: by / 1000 })}
                  onClick={() => nudge(field, by)}
                >
                  {by > 0 ? `+${by / 1000}` : by / 1000}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => play(practiceEnd(segment))}>
          {playingKey ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {t("topik.audio.playPractice")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => play(segment.end_ms)}>
          {t("topik.audio.playWhole")}
        </Button>
        {/* The two spots where a wrong cut is audible — 15 seconds instead of two minutes. */}
        <Button type="button" size="sm" variant="outline" onClick={() => playRange(headPreview(segment))}>
          {t("topik.audio.playHead", { seconds: PREVIEW_HEAD_MS / 1000 })}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          title={t("topik.audio.playTailHint", { seconds: PREVIEW_TAIL_MS / 1000 })}
          onClick={() => playRange(tailPreview(segment))}
        >
          {t("topik.audio.playTail", { seconds: PREVIEW_TAIL_MS / 1000 })}
        </Button>
      </div>

      {running && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${clipProgress(running.positionMs, running.startMs, running.endMs) * 100}%` }}
            />
          </div>
          <span aria-live="off" className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {t("topik.audio.clock", {
              at: formatDuration(running.positionMs - running.startMs),
              total: formatDuration(running.endMs - running.startMs),
            })}
          </span>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="text-sm text-destructive">
          {problems.map((p) => (
            <li key={p.message}>{t(`topik.audio.problem.${p.message}`)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
