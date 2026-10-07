import type { TFunction } from "i18next";
import type { UiLang } from "@shared/enums";
import { WORD_ERRORS, type WordSummary } from "@shared/word";
import { ApiError } from "@/lib/api";

/** The meaning shown to a profile: its gloss_lang, falling back to Vietnamese. */
export const glossFor = (w: Pick<WordSummary, "gloss_vi" | "gloss_en" | "gloss_ko">, lang: UiLang) =>
  w[`gloss_${lang}`] || w.gloss_vi;

const ERROR_KEYS = {
  [WORD_ERRORS.duplicate]: "words.errors.duplicate",
  [WORD_ERRORS.quotaExceeded]: "words.errors.quota",
  [WORD_ERRORS.aiUnavailable]: "words.errors.aiUnavailable",
  [WORD_ERRORS.aiInvalidOutput]: "words.errors.aiInvalid",
  [WORD_ERRORS.aiNotConfigured]: "words.errors.aiNotConfigured",
} as const;

export function wordErrorMessage(error: unknown, t: TFunction): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.code in ERROR_KEYS) {
    return t(ERROR_KEYS[error.code as keyof typeof ERROR_KEYS]);
  }
  return t("words.errors.generic");
}
