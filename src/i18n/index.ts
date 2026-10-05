import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { UI_LANGS, uiLangSchema, type UiLang } from "@shared/enums";
import en from "./locales/en.json";
import ko from "./locales/ko.json";
import vi from "./locales/vi.json";

export const resources = {
  vi: { translation: vi },
  ko: { translation: ko },
  en: { translation: en },
} as const;

/** Language names are shown in their own language, so they are not translated. */
export const UI_LANG_NATIVE_NAMES: Record<UiLang, string> = {
  vi: "Tiếng Việt",
  ko: "한국어",
  en: "English",
};

// Until profiles exist (M1) the UI language is remembered per device.
// In M1 it will come from the active profile's `ui_lang`.
const STORAGE_KEY = "ui_lang";

function initialLang(): UiLang {
  try {
    const parsed = uiLangSchema.safeParse(localStorage.getItem(STORAGE_KEY));
    if (parsed.success) return parsed.data;
  } catch {
    // localStorage can be unavailable (private mode); fall back to the default.
  }
  return "vi";
}

export function setUiLang(lang: UiLang): void {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Ignore: the choice just won't persist.
  }
}

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLang(),
  fallbackLng: "vi",
  supportedLngs: UI_LANGS,
  interpolation: { escapeValue: false }, // React already escapes output.
});

export default i18n;
