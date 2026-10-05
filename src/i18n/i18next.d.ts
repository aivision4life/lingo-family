import "i18next";
import type vi from "./locales/vi.json";

// Makes t("...") keys type-checked against the Vietnamese (default) locale.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof vi };
  }
}
