import { useTranslation } from "react-i18next";
import type { UiLang } from "@shared/enums";
import type { QueueItem } from "@shared/review";
import { LangText } from "@/components/LangText";
import { SpeakButton } from "@/features/audio/AudioButtons";
import { FocusTap } from "@/features/focus/FocusTap";
import { focusKey } from "@/features/focus/focusItems";
import { ItemImage } from "@/features/images/ItemImage";

type Props = { examples: QueueItem["examples"]; lang: QueueItem["word"]["lang"]; glossLang: UiLang; fallbackEmoji: string | null };

/** Back of the card: example sentences, each with a small image (drawn lazily) and an audio button. */
export function ExampleList({ examples, lang, glossLang, fallbackEmoji }: Props) {
  const { t } = useTranslation();
  if (examples.length === 0) return null;
  return (
    <ul className="flex w-full flex-col gap-3 border-t pt-3 text-left">
      {examples.map((ex) => {
        const translation = ex[`translation_${glossLang}`];
        return (
          <li key={ex.id} className="flex items-center gap-3">
            <FocusTap focusKey={focusKey("example", ex.id)} text={ex.sentence} className="flex min-w-0 flex-1 items-center gap-3">
              <ItemImage kind="example" id={ex.id} image={ex} alt={translation || ex.sentence} emoji={fallbackEmoji} size="small" lazy />
              <div className="flex min-w-0 flex-1 flex-col">
                <LangText lang={lang} className="text-lg">
                  {ex.sentence}
                </LangText>
                {translation && (
                  <span lang={glossLang} className="text-sm text-muted-foreground">
                    {translation}
                  </span>
                )}
              </div>
            </FocusTap>
            <SpeakButton audioKey={ex.audio_key} label={t("review.playAgain")} />
          </li>
        );
      })}
    </ul>
  );
}
