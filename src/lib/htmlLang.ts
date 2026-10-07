import type { LearnLang } from "@shared/enums";

/** HTML lang codes: CJK text needs them for correct glyphs (Noto Sans KR / SC). */
export const HTML_LANG: Record<LearnLang, string> = { ko: "ko", zh: "zh-CN", en: "en" };
