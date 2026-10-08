import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UiLang } from "@shared/enums";
import type { QueueItem } from "@shared/review";
import { LangText } from "@/components/LangText";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/features/audio/AudioButtons";
import { playAudio } from "@/features/audio/player";
import { glossFor } from "@/features/words/format";

type Props = { item: QueueItem; flipped: boolean; glossLang: UiLang };

/** Front: recognition = word, listening = big speaker only. Back: word, reading, meaning, Hanja/Hán-Việt. */
export function ReviewCardView({ item, flipped, glossLang }: Props) {
  const { t } = useTranslation();
  const { card, word } = item;
  const listeningFront = card.card_type === "listening" && !flipped && word.audio_key;

  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl border bg-card p-6 text-center">
      <span className="text-xs tracking-wide text-muted-foreground uppercase">{t(`review.cardType.${card.card_type}`)}</span>

      {listeningFront ? (
        <>
          <Button
            variant="secondary"
            className="size-28 rounded-full"
            aria-label={t("review.playAgain")}
            onClick={() => playAudio(word.audio_key!)}
          >
            <Volume2 className="size-12" />
          </Button>
          <p className="text-muted-foreground">{t("review.listenPrompt")}</p>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <LangText lang={word.lang} className="text-5xl font-bold">
            {word.term}
          </LangText>
          <SpeakButton audioKey={word.audio_key} label={t("review.playAgain")} />
        </div>
      )}
      {card.card_type === "listening" && !word.audio_key && !flipped && (
        <p className="text-sm text-muted-foreground">{t("review.noAudio")}</p>
      )}

      {flipped && (
        <div className="flex flex-col items-center gap-2 border-t pt-4">
          {word.emoji && (
            <span className="text-5xl" aria-hidden>
              {word.emoji}
            </span>
          )}
          <span className="text-lg text-muted-foreground">{word.reading}</span>
          {word.kind === "phrase" && word.root_term && (
            <span className="text-sm text-muted-foreground">
              {t("phrases.root", { word: "" })}
              <LangText lang={word.lang}>{word.root_term}</LangText>
            </span>
          )}
          <span lang={glossLang} className="text-2xl font-semibold">
            {glossFor(word, glossLang)}
          </span>
          {(word.hanja || word.han_viet) && (
            <span className="text-muted-foreground">
              <span lang="ko">{word.hanja}</span>
              {word.hanja && word.han_viet && " · "}
              <span lang="vi">{word.han_viet}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
