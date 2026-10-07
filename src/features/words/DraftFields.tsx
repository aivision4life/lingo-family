import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import { PARTS_OF_SPEECH, posSchema } from "@shared/word";
import { FormField } from "@/components/FormField";
import { NativeSelect } from "@/components/NativeSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AiBadge } from "./bits";
import { hanFieldsFor, type DraftErrors, type DraftTextField, type WordDraft } from "./draft";

type Props = {
  lang: LearnLang;
  draft: WordDraft;
  errors: DraftErrors;
  /** Show the AI badge next to fields that have AI-generated content. */
  aiFilled: boolean;
  onChange: (patch: Partial<WordDraft>) => void;
};

/** Which language a field's content is written in (for the `lang` attribute / fonts). */
const fieldLang = (field: DraftTextField, lang: LearnLang): string | undefined => {
  if (field === "reading") return lang === "en" ? "en" : undefined;
  if (field === "hanzi_simplified") return "zh-CN";
  if (field === "hanzi_traditional") return lang === "ko" ? "ko" : "zh-TW";
  if (field === "gloss_ko") return "ko";
  return undefined;
};

export function DraftFields({ lang, draft, errors, aiFilled, onChange }: Props) {
  const { t } = useTranslation();

  const label = (field: DraftTextField) => {
    if (field === "hanzi_traditional" && lang === "ko") return t("words.fields.hanja");
    return t(`words.fields.${field}`);
  };

  const text = (field: DraftTextField) => {
    const id = `wd-${field}`;
    const showBadge = aiFilled && draft[field] !== "";
    return (
      <FormField key={field} id={id} label={label(field)} error={errors[field] ? t("words.errors.required") : undefined}>
        <div className="flex items-center">
          <Input
            id={id}
            lang={fieldLang(field, lang)}
            value={draft[field]}
            aria-invalid={!!errors[field]}
            onChange={(e) => onChange({ [field]: e.target.value })}
          />
          {showBadge && <AiBadge />}
        </div>
      </FormField>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {text("reading")}
      <FormField id="wd-pos" label={t("words.fields.pos")}>
        <NativeSelect
          id="wd-pos"
          value={draft.pos}
          onChange={(e) => {
            const parsed = posSchema.safeParse(e.target.value);
            if (parsed.success) onChange({ pos: parsed.data });
          }}
        >
          {PARTS_OF_SPEECH.map((p) => (
            <option key={p} value={p}>
              {t(`words.pos.${p}`)}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      {text("gloss_vi")}
      {text("gloss_en")}
      {text("gloss_ko")}
      {hanFieldsFor(lang).map(text)}
      <div className="flex flex-col gap-2">
        <Label htmlFor="wd-emoji">{t("words.fields.emoji")}</Label>
        <Input
          id="wd-emoji"
          value={draft.emoji}
          onChange={(e) => onChange({ emoji: e.target.value })}
          className="w-24 text-center text-2xl"
        />
      </div>
    </div>
  );
}
