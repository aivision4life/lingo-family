// Helps avoid saving a word under the wrong language (e.g. "family" as Korean).
import { learnLangSchema, type LearnLang } from "@shared/enums";

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const HAN = /\p{Script=Han}/u;
const LATIN_ONLY = /^[\p{Script=Latin}\s'’.-]+$/u;

/** Language suggested by the script of the term, or null when unclear (empty, digits, mixed). */
export function guessLangFromScript(term: string): LearnLang | null {
  const t = term.trim();
  if (!t) return null;
  if (HANGUL.test(t)) return "ko";
  if (HAN.test(t)) return "zh";
  if (LATIN_ONLY.test(t) && /\p{Letter}/u.test(t)) return "en";
  return null;
}

// The language last chosen on the Add word screen, remembered per device.
const LAST_LANG_KEY = "add_word_lang";

export function readLastAddLang(): LearnLang | null {
  try {
    const parsed = learnLangSchema.safeParse(localStorage.getItem(LAST_LANG_KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveLastAddLang(lang: LearnLang): void {
  try {
    localStorage.setItem(LAST_LANG_KEY, lang);
  } catch {
    // Ignore: the choice just won't persist.
  }
}
