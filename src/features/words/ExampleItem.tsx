import type { z } from "zod";
import { UI_LANGS, type LearnLang, type UiLang } from "@shared/enums";
import type { exampleSchema } from "@shared/base";
import { LangText } from "@/components/LangText";
import { ExampleEditControls, type ExampleOwner } from "@/features/examples/ExampleActions";
import { FocusTap } from "@/features/focus/FocusTap";
import { focusKey } from "@/features/focus/focusItems";
import { SpeakButton } from "@/features/audio/AudioButtons";
import { ImageTools } from "@/features/images/ImageTools";
import { ItemImage } from "@/features/images/ItemImage";

type Example = z.infer<typeof exampleSchema>;

type Props = {
  ex: Example;
  lang: LearnLang;
  glossLang: UiLang;
  audioLabel: string;
  /** Adults: edit and delete this sentence (M2.6). Kids and read-only screens leave it out. */
  owner?: ExampleOwner;
};

/** An example sentence: small picture (drawn the first time it is shown), text, translations, audio. */
export function ExampleItem({ ex, lang, glossLang, audioLabel, owner }: Props) {
  if (owner) {
    return (
      <ExampleEditControls owner={owner} example={ex}>
        {(controls) => <ExampleView ex={ex} lang={lang} glossLang={glossLang} audioLabel={audioLabel} controls={controls} />}
      </ExampleEditControls>
    );
  }
  return <ExampleView ex={ex} lang={lang} glossLang={glossLang} audioLabel={audioLabel} />;
}

function ExampleView({ ex, lang, glossLang, audioLabel, controls }: Omit<Props, "owner"> & { controls?: React.ReactNode }) {
  const meaning = ex[`translation_${glossLang}`] || ex.translation_en || ex.sentence;
  return (
    <div className="flex items-start gap-3">
      <FocusTap focusKey={focusKey("example", ex.id)} text={ex.sentence} className="shrink-0">
        <ItemImage kind="example" id={ex.id} image={ex} alt={meaning} size="small" lazy />
      </FocusTap>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <FocusTap focusKey={focusKey("example", ex.id)} text={ex.sentence} className="min-w-0 flex-1">
            <LangText lang={lang} className="block text-lg">
              {ex.sentence}
            </LangText>
          </FocusTap>
          <SpeakButton audioKey={ex.audio_key} label={audioLabel} />
          {controls}
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
