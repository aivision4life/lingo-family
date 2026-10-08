import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HTML_LANG } from "@/lib/htmlLang";
import type { PhraseDraft, PhraseDraftErrors, PhraseTextField } from "./phraseDraft";

type Props = {
  lang: LearnLang;
  draft: PhraseDraft;
  errors?: PhraseDraftErrors;
  onChange: (patch: Partial<PhraseDraft>) => void;
};

/** The `lang` attribute of each field's content (Korean glyphs need lang="ko"). */
const fieldLang = (f: PhraseTextField, lang: LearnLang): string | undefined => {
  if (f === "text" || f === "sentence") return HTML_LANG[lang];
  if (f === "gloss_ko" || f === "translation_ko") return "ko";
  if (f === "gloss_vi" || f === "translation_vi") return "vi";
  if (f === "gloss_en" || f === "translation_en") return "en";
  return undefined;
};

/** Edits one phrase draft: text, reading, meanings and its single example sentence. */
export function PhraseFields({ lang, draft, errors = {}, onChange }: Props) {
  const { t } = useTranslation();
  // A sentence is never translated into its own language.
  const translations = (["translation_vi", "translation_en", "translation_ko"] as const).filter(
    (f) => f !== `translation_${lang}`,
  );
  const fields: PhraseTextField[] = ["text", "reading", "gloss_vi", "gloss_en", "gloss_ko", "sentence", ...translations];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `${draft.key}-${f}`;
        return (
          <div key={f} className={f === "sentence" ? "flex flex-col gap-1 sm:col-span-2" : "flex flex-col gap-1"}>
            <Label htmlFor={id}>{t(`phrases.fields.${f}`)}</Label>
            <Input
              id={id}
              lang={fieldLang(f, lang)}
              value={draft[f]}
              aria-invalid={!!errors[f]}
              onChange={(e) => onChange({ [f]: e.target.value })}
            />
            {errors[f] && (
              <p role="alert" className="text-xs text-destructive">
                {t("words.errors.required")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
