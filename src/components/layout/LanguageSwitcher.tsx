import { useTranslation } from "react-i18next";
import { UI_LANGS, uiLangSchema } from "@shared/enums";
import { setUiLang, UI_LANG_NATIVE_NAMES } from "@/i18n";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <select
      aria-label={t("nav.uiLanguage")}
      value={i18n.resolvedLanguage}
      onChange={(e) => {
        const parsed = uiLangSchema.safeParse(e.target.value);
        if (parsed.success) setUiLang(parsed.data);
      }}
      className="h-11 rounded-md border bg-background px-2 text-sm"
    >
      {UI_LANGS.map((lang) => (
        <option key={lang} value={lang} lang={lang}>
          {UI_LANG_NATIVE_NAMES[lang]}
        </option>
      ))}
    </select>
  );
}
