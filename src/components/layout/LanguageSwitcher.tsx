import { useTranslation } from "react-i18next";
import { UI_LANGS, uiLangSchema } from "@shared/enums";
import { NativeSelect } from "@/components/NativeSelect";
import { setUiLang, UI_LANG_NATIVE_NAMES } from "@/i18n";

/**
 * Device-level UI language, used on the profile picker before a profile is chosen.
 * Once a profile is active, its `ui_lang` setting wins.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <NativeSelect
      aria-label={t("nav.uiLanguage")}
      value={i18n.resolvedLanguage}
      onChange={(e) => {
        const parsed = uiLangSchema.safeParse(e.target.value);
        if (parsed.success) setUiLang(parsed.data);
      }}
    >
      {UI_LANGS.map((lang) => (
        <option key={lang} value={lang} lang={lang}>
          {UI_LANG_NATIVE_NAMES[lang]}
        </option>
      ))}
    </NativeSelect>
  );
}
