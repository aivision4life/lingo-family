import type { ExampleLevel, LearnLang } from "../../shared/enums";

/** Bump when the prompt or output schema changes, so old cache entries are not reused. */
// v2 (M1.6): Chinese removed, hanzi_* fields replaced by `hanja`.
export const ENRICH_PROMPT_VERSION = "enrich-v2";

const LANG_RULES: Record<LearnLang, string> = {
  ko: [
    "The word is Korean (Hangul).",
    "reading: Revised Romanization of Korean, lowercase, syllables joined (e.g. haksaeng).",
    "If the word is Sino-Korean: hanja = its Hanja (traditional characters), han_viet = the Sino-Vietnamese (Hán-Việt) reading of those characters in lowercase Vietnamese.",
    "If it is native Korean or a loanword: hanja and han_viet are empty strings.",
    "gloss_ko: a short Korean definition.",
  ].join("\n"),
  en: [
    "The word is English.",
    "reading: US English IPA between slashes (e.g. /ˈæp.əl/).",
    "hanja and han_viet are empty strings.",
    "gloss_en: a short English definition.",
  ].join("\n"),
};

const LEVEL_RULES: Record<ExampleLevel, string> = {
  kid: "Example sentences are for a young child: very short (3-6 words), concrete, everyday situations.",
  beginner: "Example sentences are for a beginner: short and simple, common vocabulary.",
  intermediate:
    "Example sentences are for an intermediate adult learner; workplace and IT/office contexts are welcome.",
};

/** The translation field that equals the sentence's own language (left empty). */
const OWN_TRANSLATION: Record<LearnLang, string> = {
  ko: "translation_ko",
  en: "translation_en",
};

export function buildEnrichPrompt(lang: LearnLang, term: string, level: ExampleLevel) {
  const system = [
    "You are a careful bilingual lexicographer building flashcards for a Vietnamese family that also speaks Korean.",
    "Answer with a single JSON object that matches the given schema. No markdown, no comments.",
    "gloss_vi, gloss_en, gloss_ko: short natural meanings (1-5 words each, several senses separated by '; ').",
    "If the word has several unrelated meanings (homonyms), describe only the most common one, and make every field (Hanja, Hán-Việt, glosses, examples) match that one meaning.",
    "A gloss must explain the meaning; never just repeat the word itself.",
    "pos: the most common part of speech.",
    "emoji: one emoji that best pictures the word, or an empty string if none fits.",
    "examples: 2 or 3 natural sentences in the word's language that use the word, each with translations into Vietnamese, English and Korean.",
    `Leave ${OWN_TRANSLATION[lang]} empty for example sentences, because the sentence is already in that language.`,
    LANG_RULES[lang],
    LEVEL_RULES[level],
    "If you are unsure about Hanja or Hán-Việt, prefer an empty string over a guess.",
  ].join("\n");

  return { system, user: `Word: ${term}` };
}
