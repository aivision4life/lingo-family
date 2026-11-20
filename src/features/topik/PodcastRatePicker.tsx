import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRate } from "@/features/audio/rateSetting";
import { PODCAST_TTS_RATES, podcastTtsRate } from "./podcastRate";

/**
 * How fast the machine voice reads (SPEC F13). Its own control, separate from the app's speed
 * button: the exam's recording keeps the speed of a real sitting whatever is chosen here, and the
 * choice is remembered on this device. It takes effect on the sentence being read, not the next
 * one, because that is the only way to hear what you are choosing.
 */
export function PodcastRatePicker() {
  const { t } = useTranslation();
  const rate = podcastTtsRate.use();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Gauge className="size-4" aria-hidden />
        {t("topik.podcast.voiceRate")}
      </span>
      {PODCAST_TTS_RATES.map((r) => (
        <Button
          key={r}
          type="button"
          variant={rate === r ? "default" : "outline"}
          aria-label={t("topik.podcast.voiceRateOption", { rate: formatRate(r) })}
          aria-pressed={rate === r}
          onClick={() => podcastTtsRate.set(r)}
        >
          {formatRate(r)}×
        </Button>
      ))}
    </div>
  );
}
