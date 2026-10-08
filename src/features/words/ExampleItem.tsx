import type { z } from "zod";
import { UI_LANGS, type LearnLang, type UiLang } from "@shared/enums";
import type { exampleSchema } from "@shared/base";
import { LangText } from "@/components/LangText";
import { SpeakButton } from "@/features/audio/AudioButtons";
import { ImageTools } from "@/features/images/ImageTools";
import { ItemImage } from "@/features/images/ItemImage";

type Example = z.infer<typeof exampleSchema>;

type Props = { ex: Example; lang: LearnLang; glossLang: UiLang; audioLabel: string };

/** An example sentence: small picture (drawn the first time it is shown), text, translations, audio. */
export function ExampleItem({ ex, lang, glossLang, audioLabel }: Props) {
  const meaning = ex[`translation_${glossLang}`] || ex.translation_en || ex.sentence;
  return (
    <div className="flex items-start gap-3">
      <ItemImage kind="example" id={ex.id} image={ex} alt={meaning} size="small" lazy />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <LangText lang={lang} className="block text-lg">
            {ex.sentence}
          </LangText>
          <SpeakButton audioKey={ex.audio_key} label={audioLabel} />
        </div>
        {UI_LANGS.filter((l) => ex[`translation_${l}`]).map((l) => (
          <p key={l} lang={l} className="text-sm text-muted-foreground">
            {ex[`translation_${l}`]}
          </p>
        ))}
        <ImageTools kind="example" id={ex.id} image={ex} suggestion={ex.translation_en || ex.sentence} compact />
      </div>
    </div>
  );
}
