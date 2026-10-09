import { Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UiLang } from "@shared/enums";
import type { QueueItem } from "@shared/review";
import { LangText } from "@/components/LangText";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/features/audio/AudioButtons";
import { playAudio } from "@/features/audio/player";
import { ItemImage } from "@/features/images/ItemImage";
import { glossFor } from "@/features/words/format";
import { cardFace } from "./cardFace";
import { ExampleList } from "./ExampleList";

/** Queue items carry only the image key and status. */
const NO_IMAGE_META = { image_prompt: null, image_source: null, image_requested_at: null };

type Props = { item: QueueItem; flipped: boolean; glossLang: UiLang };

/**
 * Image-centred card (SPEC F4 faces, M1.9). Phones: big square image on top, text below.
 * Desktop (md+): image on the left, content on the right. Which parts show on each side is
 * decided by `cardFace()`.
 */
export function ReviewCardView({ item, flipped, glossLang }: Props) {
  const { t } = useTranslation();
  const { card, word } = item;
  const face = cardFace(card.card_type, flipped);
  const gloss = glossFor(word, glossLang);

  return (
    <div className={`grid gap-4 md:items-start ${face.image ? "md:grid-cols-2" : ""}`}>
      {face.image && (
        <ItemImage
          kind={word.kind}
          id={word.id}
          image={{ ...NO_IMAGE_META, image_key: word.image_key, image_status: word.image_status }}
          alt={gloss}
          emoji={word.emoji}
          size="large"
          className="mx-auto max-w-none md:max-w-96"
        />
      )}

      <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
        <span className="text-xs tracking-wide text-muted-foreground uppercase">{t(`review.cardType.${card.card_type}`)}</span>

        {face.bigSpeaker &&
          (word.audio_key ? (
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
            <p className="text-sm text-muted-foreground">{t("review.noAudio")}</p>
          ))}

        {face.term && (
          <div className="flex items-center gap-2">
            <LangText lang={word.lang} className="text-5xl font-bold">
              {word.term}
            </LangText>
            <SpeakButton audioKey={word.audio_key} label={t("review.playAgain")} />
          </div>
        )}

        {face.meaning && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-lg text-muted-foreground">{word.reading}</span>
            {word.kind === "phrase" && word.root_term && (
              <span className="text-sm text-muted-foreground">
                {t("phrases.root", { word: "" })}
                <LangText lang={word.lang}>{word.root_term}</LangText>
              </span>
            )}
            <span lang={glossLang} className="text-2xl font-semibold">
              {gloss}
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

        {face.meaning && <ExampleList examples={item.examples} lang={word.lang} glossLang={glossLang} fallbackEmoji={word.emoji} />}
      </div>
    </div>
  );
}
