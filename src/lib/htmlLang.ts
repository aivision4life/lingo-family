import type { LearnLang } from "@shared/enums";

/** HTML lang codes: Korean text needs `lang="ko"` for correct glyphs (Noto Sans KR). */
export const HTML_LANG: Record<LearnLang, string> = { ko: "ko", en: "en" };
