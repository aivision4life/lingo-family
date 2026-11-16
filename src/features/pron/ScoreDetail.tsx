import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import type { PronScoreResponse } from "@shared/pron";
import { pronBand, pronWordPieces, type PronBand } from "@shared/pronScore";
import { cn } from "@/lib/utils";

/** One class per band; the thresholds themselves live in `pronBand` (shared), never here. */
const BAND_TEXT: Record<PronBand, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  fair: "text-amber-600 dark:text-amber-400",
  poor: "text-red-600 dark:text-red-400",
  unknown: "text-foreground",
};

/**
 * The score of one take (M3.2, SPEC F5): the overall number, and the text coloured at the most
 * detailed level the answer carries — per Hangul syllable for Korean, per word otherwise.
 */
export function ScoreDetail({ result, lang }: { result: PronScoreResponse; lang: LearnLang }) {
  const { t } = useTranslation();
  const overall = Math.round(result.pron_score);
  const band = pronBand(result.pron_score);

  return (
    <div className="flex flex-col items-center gap-1" aria-live="polite">
      <p className="flex items-baseline gap-2">
        <span className={cn("text-3xl font-bold tabular-nums", BAND_TEXT[band])}>{overall}</span>
        <span className="text-sm text-muted-foreground">{t("pron.outOf")}</span>
        <span className="sr-only">{t(`pron.band.${band}`)}</span>
      </p>
      <p lang={lang} className="flex flex-wrap justify-center gap-x-2 text-2xl font-semibold">
        {result.details.words.map((word, w) => (
          <span key={`${word.text}-${w}`}>
            {pronWordPieces(word).map((piece, i) => (
              <span key={i} className={BAND_TEXT[pronBand(piece.score)]}>
                {piece.text}
              </span>
            ))}
          </span>
        ))}
      </p>
    </div>
  );
}
