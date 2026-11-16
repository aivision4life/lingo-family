import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import { pronScoreResponseSchema, type PronScoreResponse } from "@shared/pron";
import { PRON_MAX_SECONDS } from "@shared/wav";
import { Button } from "@/components/ui/button";
import { apiUpload } from "@/lib/api";
import { pronFailure, type PronFailure } from "./pronFailure";
import { startRecording, type ActiveRecording } from "./recorder";
import { ScoreDetail } from "./ScoreDetail";

/** What is being practised: the word, the phrase or the example sentence (one `pron_attempts` column each). */
export type PronTarget = { kind: "word" | "phrase" | "example"; id: string };

type Props = { target: PronTarget; lang: LearnLang; text: string; profileId: string };
type Phase = "idle" | "recording" | "scoring";

const targetParam = (target: PronTarget) => `${target.kind}_id` as "word_id" | "phrase_id" | "example_id";

/**
 * "Record & score" for one item (M3.2, SPEC F5). Kid profiles may use it too — the server gives
 * them the smaller daily allowance and nothing here needs to know.
 *
 * The take stops by itself at `PRON_MAX_SECONDS`, the length the Worker accepts, and is sent
 * straight to `POST /api/pron/score`. M3.2 keeps no recording: the blob is dropped as soon as it
 * has been scored (playback and "Compare" come with the next step), so nothing leaves the device
 * but the scores — F5's privacy rule.
 */
export function RecordScore({ target, lang, text, profileId }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<PronScoreResponse | null>(null);
  const [failure, setFailure] = useState<PronFailure | null>(null);
  const active = useRef<ActiveRecording | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Leaving the view mid-take must let go of the microphone.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      active.current?.cancel();
    },
    [],
  );

  const stop = async () => {
    window.clearTimeout(timer.current);
    const recording = active.current;
    active.current = null;
    if (!recording) return;
    setPhase("scoring");
    try {
      const take = await recording.stop();
      const query = new URLSearchParams({ profile_id: profileId, lang, reference_text: text, [targetParam(target)]: target.id });
      setResult(await apiUpload(`/pron/score?${query.toString()}`, take.wav, pronScoreResponseSchema));
    } catch (e) {
      setFailure(pronFailure(e));
    } finally {
      setPhase("idle");
    }
  };

  // Called straight from the tap, with no await before it: see startRecording().
  const start = () => {
    setResult(null);
    setFailure(null);
    setPhase("recording");
    startRecording().then(
      (recording) => {
        active.current = recording;
        timer.current = window.setTimeout(() => void stop(), PRON_MAX_SECONDS * 1000);
      },
      (e: unknown) => {
        setPhase("idle");
        setFailure(pronFailure(e));
      },
    );
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {result && <ScoreDetail result={result} lang={lang} />}
      {failure && (
        <p role="alert" className="max-w-md text-center text-sm text-destructive">
          {t(`pron.failure.${failure}`)}
        </p>
      )}
      {phase === "recording" ? (
        <Button type="button" variant="destructive" size="lg" className="min-h-14 w-full max-w-md text-lg" onClick={() => void stop()}>
          <Square className="size-5" aria-hidden />
          {t("pron.stop")}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="min-h-14 w-full max-w-md text-lg"
          disabled={phase === "scoring"}
          onClick={start}
        >
          <Mic className="size-5" aria-hidden />
          {phase === "scoring" ? t("pron.scoring") : result || failure ? t("pron.again") : t("pron.record")}
        </Button>
      )}
      {phase === "recording" && (
        <p aria-live="polite" className="text-sm text-destructive">
          {t("pron.recording", { seconds: PRON_MAX_SECONDS })}
        </p>
      )}
    </div>
  );
}
