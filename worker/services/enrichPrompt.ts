import type { ExampleLevel, LearnLang } from "../../shared/enums";
import { IMAGE_PROMPT_RULES } from "./imagePrompt";

/** Bump when the prompt or output schema changes, so old cache entries are not reused. */
// v2 (M1.6): Chinese removed, hanzi_* fields replaced by `hanja`. v3 (M1.7): phrases, 2 examples.
// v4 (M1.8): image_prompt for the word, each example and each phrase (+ its example).
export const ENRICH_PROMPT_VERSION = "enrich-v4";
/** Version of the "suggest phrases for an existing word" prompt (part of its cache key). */
export const PHRASES_PROMPT_VERSION = "phrases-v2";

/** Where image prompts are needed; the rules themselves are shared with stand-alone requests. */
const IMAGE_FIELDS = [
  "Pictures: the word, every example sentence, every phrase and every phrase example has its own field `image_prompt`.",
  IMAGE_PROMPT_RULES,
].join("\n");

const READING_RULES: Record<LearnLang, string> = {
  ko: "reading: Revised Romanization of Korean, lowercase, syllables joined (e.g. haksaeng).",
  en: "reading: US English IPA between slashes (e.g. /ˈæp.əl/).",
};

const LANG_RULES: Record<LearnLang, string> = {
  ko: [
    "The word is Korean (Hangul).",
    READING_RULES.ko,
    "If the word is Sino-Korean: hanja = its Hanja (traditional characters), han_viet = the Sino-Vietnamese (Hán-Việt) reading of those characters in lowercase Vietnamese.",
    "If it is native Korean or a loanword: hanja and han_viet are empty strings.",
    "gloss_ko: a short Korean definition.",
  ].join("\n"),
  en: [
    "The word is English.",
    READING_RULES.en,
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

const PHRASE_RULES = [
  "phrases: 1 to 3 common, useful phrases (collocations or short expressions) in the same language that contain the word, e.g. 학생 → 대학생, 학생증; apple → apple pie.",
  "Each phrase has: text, reading (same rules as the word's reading), gloss_vi, gloss_en, gloss_ko, and exactly 1 example sentence using the phrase (field `example`), with translations.",
  "A phrase must differ from the word itself; prefer phrases a learner at the given level will meet often.",
].join("\n");

const ROLE = "You are a careful bilingual lexicographer building flashcards for a Vietnamese family that also speaks Korean.";

export function buildEnrichPrompt(lang: LearnLang, term: string, level: ExampleLevel) {
  const system = [
    ROLE,
    "Answer with a single JSON object that matches the given schema. No markdown, no comments.",
    "gloss_vi, gloss_en, gloss_ko: short natural meanings (1-5 words each, several senses separated by '; ').",
    "If the word has several unrelated meanings (homonyms), describe only the most common one, and make every field (Hanja, Hán-Việt, glosses, examples, phrases) match that one meaning.",
    "A gloss must explain the meaning; never just repeat the word itself.",
    "pos: the most common part of speech.",
    "emoji: one emoji that best pictures the word, or an empty string if none fits.",
    "examples: exactly 2 natural sentences in the word's language that use the word, each with translations into Vietnamese, English and Korean.",
    PHRASE_RULES,
    IMAGE_FIELDS,
    `Leave ${OWN_TRANSLATION[lang]} empty for all example sentences, because the sentence is already in that language.`,
    LANG_RULES[lang],
    LEVEL_RULES[level],
    "If you are unsure about Hanja or Hán-Việt, prefer an empty string over a guess.",
  ].join("\n");

  return { system, user: `Word: ${term}` };
}

/** Prompt for suggesting phrases for a word that is already in the library. */
export function buildPhrasePrompt(lang: LearnLang, term: string, level: ExampleLevel) {
  const system = [
    ROLE,
    'Answer with a single JSON object {"phrases": [...]} that matches the given schema. No markdown, no comments.',
    PHRASE_RULES,
    IMAGE_FIELDS,
    "gloss_vi, gloss_en, gloss_ko: short natural meanings (1-5 words each); never just repeat the phrase.",
    `Leave ${OWN_TRANSLATION[lang]} empty for example sentences, because the sentence is already in that language.`,
    READING_RULES[lang],
    LEVEL_RULES[level],
  ].join("\n");
  return { system, user: `Word: ${term}` };
}
