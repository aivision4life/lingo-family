import { Gauge, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PLAYBACK_RATES, useAudioPlayer } from "./player";

type SpeakButtonProps = {
  /** R2 key from the API; nothing is rendered while the audio does not exist yet. */
  audioKey: string | null;
  label: string;
  className?: string;
};

/** Speaker button (44px tap target) that plays one stored audio file. */
export function SpeakButton({ audioKey, label, className }: SpeakButtonProps) {
  const { play, playingKey } = useAudioPlayer();
  if (!audioKey) return null;
  const playing = playingKey === audioKey;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={playing}
      onClick={() => play(audioKey)}
      className={cn("shrink-0", className)}
    >
      <Volume2 className={cn("size-6", playing && "animate-pulse text-primary")} />
    </Button>
  );
}

const formatRate = (rate: number) => (rate === 1 ? "1.0" : String(rate));

/** Toggles playback speed between 1.0× and 0.75× for all audio. */
export function SpeedToggle() {
  const { t } = useTranslation();
  const { rate, setRate } = useAudioPlayer();
  const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate) + 1) % PLAYBACK_RATES.length]!;

  return (
    <Button
      type="button"
      variant="outline"
      aria-label={t("audio.rateHint", { rate: formatRate(rate) })}
      onClick={() => setRate(next)}
    >
      <Gauge aria-hidden />
      {t("audio.rate", { rate: formatRate(rate) })}
    </Button>
  );
}
