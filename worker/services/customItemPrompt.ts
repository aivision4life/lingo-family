// Prompts for sentences and phrases typed by hand (M2.6). Bump the version when a prompt or its
// output schema changes: it is part of the ai_cache key.
import type { LearnLang } from "../../shared/enums";
import { IMAGE_PROMPT_RULES } from "./imagePrompt";

export const ENRICH_SENTENCE_VERSION = "enrich-sentence-v1";
export const ENRICH_PHRASE_VERSION = "enrich-phrase-v1";

const LANGUAGE = { ko: "Korean", en: "English" } as const;
const ROLE = "You are a careful bilingual teacher helping a Vietnamese family that also speaks Korean build flashcards.";

const wordLine = (term: string, gloss: string) => `Root word: ${term}${gloss ? ` (meaning: ${gloss})` : ""}`;

export function buildSentencePrompt(lang: LearnLang, text: string, term: string, gloss: string) {
  const own = lang === "ko" ? "translation_ko" : "translation_en";
  const system = [
    ROLE,
    "Answer with a single JSON object that matches the given schema. No markdown, no comments.",
    `The sentence is written by a learner in ${LANGUAGE[lang]}.`,
    "translation_vi, translation_en, translation_ko: natural translations of the sentence exactly as written (do not correct it here).",
    `Leave ${own} empty: the sentence is already in that language.`,
    IMAGE_PROMPT_RULES,
    "contains_word: true when the sentence contains the root word or an inflected / conjugated form of it, otherwise false.",
    "suggestion: ONLY when the sentence has a mistake (grammar, wrong word, wrong particle or ending) or sounds unnatural to a native speaker, write one corrected, natural sentence that keeps the meaning, uses the root word and stays as simple as the original. If the sentence is already correct and natural, suggestion is an empty string; never suggest a purely stylistic alternative.",
    `When suggestion is not empty, also fill suggestion_translation_vi / _en / _ko (leave the ${lang === "ko" ? "Korean" : "English"} one empty) and suggestion_image_prompt for the SUGGESTED sentence, and note_vi: one short Vietnamese sentence (at most 120 characters) saying what was wrong.`,
    "When suggestion is empty, suggestion_translation_*, suggestion_image_prompt and note_vi are empty strings.",
  ].join("\n");
  return { system, user: `${wordLine(term, gloss)}\nSentence (${LANGUAGE[lang]}): ${text}` };
}

export function buildPhrasePromptFor(lang: LearnLang, text: string, term: string, gloss: string) {
  const readingRule =
    lang === "ko"
      ? "reading: Revised Romanization of Korean, lowercase, syllables joined (e.g. daehaksaeng)."
      : "reading: US English IPA between slashes (e.g. /ˈæp.əl pɑɪ/).";
  const system = [
    ROLE,
    "Answer with a single JSON object that matches the given schema. No markdown, no comments.",
    `The phrase is a collocation or short expression in ${LANGUAGE[lang]} written by a learner.`,
    readingRule,
    "gloss_vi, gloss_en, gloss_ko: short natural meanings (1-5 words each). The gloss in the phrase's own language is a short definition, never just the phrase itself.",
    IMAGE_PROMPT_RULES,
    "contains_word: true when the phrase contains the root word or an inflected form of it, otherwise false.",
  ].join("\n");
  return { system, user: `${wordLine(term, gloss)}\nPhrase (${LANGUAGE[lang]}): ${text}` };
}
