import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import { EXAMPLES_MAX } from "@shared/word";
import { HTML_LANG } from "@/lib/htmlLang";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AiBadge } from "./bits";
import { emptyExample, type ExampleDraft } from "./draft";

type Props = {
  lang: LearnLang;
  examples: ExampleDraft[];
  onChange: (examples: ExampleDraft[]) => void;
};

type TranslationField = "translation_vi" | "translation_en" | "translation_ko";
const TRANSLATION_LANG: Record<TranslationField, string> = {
  translation_vi: "vi",
  translation_en: "en",
  translation_ko: "ko",
};

/** Edit 0-5 example sentences; a sentence is never translated into its own language. */
export function ExamplesEditor({ lang, examples, onChange }: Props) {
  const { t } = useTranslation();
  const translations = (Object.keys(TRANSLATION_LANG) as TranslationField[]).filter(
    (f) => TRANSLATION_LANG[f] !== lang,
  );

  const update = (key: string, patch: Partial<ExampleDraft>) =>
    onChange(examples.map((ex) => (ex.key === key ? { ...ex, ...patch } : ex)));

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-lg font-semibold">{t("words.fields.examples")}</legend>
      {examples.map((ex, i) => (
        <div key={ex.key} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <Label htmlFor={`ex-${ex.key}`}>
              {t("words.fields.sentence", { n: i + 1 })}
              {ex.ai_generated && <AiBadge />}
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("words.fields.removeExample", { n: i + 1 })}
              onClick={() => onChange(examples.filter((e) => e.key !== ex.key))}
            >
              <Trash2 className="size-5" />
            </Button>
          </div>
          <Input
            id={`ex-${ex.key}`}
            lang={HTML_LANG[lang]}
            value={ex.sentence}
            onChange={(e) => update(ex.key, { sentence: e.target.value })}
          />
          {translations.map((f) => (
            <Input
              key={f}
              aria-label={t(`words.fields.${f}`)}
              placeholder={t(`words.fields.${f}`)}
              lang={TRANSLATION_LANG[f]}
              value={ex[f]}
              onChange={(e) => update(ex.key, { [f]: e.target.value })}
            />
          ))}
        </div>
      ))}
      {examples.length < EXAMPLES_MAX && (
        <Button type="button" variant="outline" onClick={() => onChange([...examples, emptyExample()])}>
          <Plus aria-hidden />
          {t("words.fields.addExample")}
        </Button>
      )}
    </fieldset>
  );
}
