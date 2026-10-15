// AI help for sentences and phrases typed by hand (M2.6): cache-first, one (retried) LLM call.
import {
  llmPhraseFillSchema,
  llmSentenceCheckSchema,
  phraseFillSchema,
  sentenceCheckSchema,
  type EnrichPhraseRequest,
  type EnrichSentenceRequest,
  type LlmPhraseFill,
  type LlmSentenceCheck,
  type PhraseFill,
  type SentenceCheck,
} from "../../shared/customItem";
import type { LearnLang } from "../../shared/enums";
import { sha256Hex } from "../lib/hash";
import { checkEnglishText, checkKoreanText, checkLangText, checkPhraseFill, checkSentenceCheck, checkVietnameseText } from "./contentCheck";
import { buildPhrasePromptFor, buildSentencePrompt, ENRICH_PHRASE_VERSION, ENRICH_SENTENCE_VERSION } from "./customItemPrompt";
import { cachedTask, type Db } from "./enrich";
import { generateStructured, type LlmClient } from "./llm";

type Common = { db: Db; llm: LlmClient; beforeLlmCall: () => Promise<void> };

const flat = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/** A sentence is never translated into its own language. */
const ownLangEmpty = (lang: LearnLang, t: { vi: string; en: string; ko: string }) => ({
  translation_vi: t.vi.trim(),
  translation_en: lang === "en" ? "" : t.en.trim(),
  translation_ko: lang === "ko" ? "" : t.ko.trim(),
});

/**
 * Turns the LLM answer into the app's shape. A suggestion is kept only when it is a real change
 * (not the same sentence) and the model also gave its image prompt; its reason `note_vi` exists
 * exactly when the suggestion does. A suggestion with a script problem (M2.11, after the one retry
 * `generateStructured` already gave it) is dropped the same way — logged, never saved; the
 * sentence's own translations cannot be dropped the same way (there is no "original" to fall back
 * to), so a problem there is only logged.
 */
export function finalizeSentenceCheck(lang: LearnLang, text: string, raw: LlmSentenceCheck, allowedWords: readonly string[] = []): SentenceCheck {
  const own = ownLangEmpty(lang, { vi: raw.translation_vi, en: raw.translation_en, ko: raw.translation_ko });
  const ownProblems = [
    ...checkVietnameseText(own.translation_vi),
    ...(own.translation_en ? checkEnglishText(own.translation_en) : []),
    ...(own.translation_ko ? checkKoreanText(own.translation_ko, allowedWords) : []),
  ];
  if (ownProblems.length > 0) console.error(`[enrich-sentence] translation has a script problem (kept): ${ownProblems.join("; ")}`);

  const suggestionText = raw.suggestion.trim();
  const suggestionTranslations = ownLangEmpty(lang, { vi: raw.suggestion_translation_vi, en: raw.suggestion_translation_en, ko: raw.suggestion_translation_ko });
  let hasSuggestion = suggestionText !== "" && flat(suggestionText) !== flat(text) && raw.suggestion_image_prompt.trim().length >= 10;
  if (hasSuggestion) {
    const suggestionProblems = [
      ...checkLangText(lang, suggestionText, allowedWords),
      ...checkVietnameseText(suggestionTranslations.translation_vi),
      ...(suggestionTranslations.translation_en ? checkEnglishText(suggestionTranslations.translation_en) : []),
      ...(suggestionTranslations.translation_ko ? checkKoreanText(suggestionTranslations.translation_ko, allowedWords) : []),
    ];
    if (suggestionProblems.length > 0) {
      console.error(`[enrich-sentence] dropping a suggested rewrite with a script problem: ${suggestionProblems.join("; ")}`);
      hasSuggestion = false;
    }
  }

  return {
    sentence: { text, ...own, image_prompt: raw.image_prompt.trim() },
    contains_word: raw.contains_word,
    suggestion: hasSuggestion ? { text: suggestionText, ...suggestionTranslations, image_prompt: raw.suggestion_image_prompt.trim() } : null,
    note_vi: hasSuggestion ? raw.note_vi.trim() || null : null,
  };
}

type Key = { lang: LearnLang; text: string; word_term: string; word_gloss: string };

export const sentenceCacheKey = (model: string, r: Key) =>
  sha256Hex(JSON.stringify(["enrich-sentence", ENRICH_SENTENCE_VERSION, model, r.lang, r.text, r.word_term, r.word_gloss]));

export const phraseFillCacheKey = (model: string, r: Key) =>
  sha256Hex(JSON.stringify(["enrich-phrase", ENRICH_PHRASE_VERSION, model, r.lang, r.text, r.word_term, r.word_gloss]));

export async function enrichSentenceWithCache({ db, llm, beforeLlmCall, input }: Common & { input: EnrichSentenceRequest }) {
  const { value, cached } = await cachedTask<SentenceCheck>({
    db,
    key: await sentenceCacheKey(llm.model, input),
    cachedSchema: sentenceCheckSchema,
    beforeLlmCall,
    produce: async () => {
      const allowedWords = input.lang === "en" ? [input.word_term] : [];
      const { data, model } = await generateStructured(
        llm,
        llmSentenceCheckSchema,
        buildSentencePrompt(input.lang, input.text, input.word_term, input.word_gloss),
        (d) => checkSentenceCheck(input.lang, d, allowedWords),
      );
      return { value: finalizeSentenceCheck(input.lang, input.text, data, allowedWords), model };
    },
  });
  return { check: value, cached };
}

/** A gloss that still has a script problem after the retry (M2.11) cannot be dropped the way a
 * suggested example can (there is nothing to fall back to) — only logged. */
export function finalizePhraseFill(text: string, raw: LlmPhraseFill, allowedWords: readonly string[] = []): PhraseFill {
  const problems = checkPhraseFill(raw, allowedWords);
  if (problems.length > 0) console.error(`[enrich-phrase] gloss has a script problem (kept): ${problems.join("; ")}`);
  return {
    text,
    reading: raw.reading.trim(),
    gloss_vi: raw.gloss_vi.trim(),
    gloss_en: raw.gloss_en.trim(),
    gloss_ko: raw.gloss_ko.trim(),
    image_prompt: raw.image_prompt.trim(),
    contains_word: raw.contains_word,
  };
}

export async function enrichPhraseWithCache({ db, llm, beforeLlmCall, input }: Common & { input: EnrichPhraseRequest }) {
  const { value, cached } = await cachedTask<PhraseFill>({
    db,
    key: await phraseFillCacheKey(llm.model, input),
    cachedSchema: phraseFillSchema,
    beforeLlmCall,
    produce: async () => {
      const allowedWords = input.lang === "en" ? [input.word_term] : [];
      const { data, model } = await generateStructured(
        llm,
        llmPhraseFillSchema,
        buildPhrasePromptFor(input.lang, input.text, input.word_term, input.word_gloss),
        (d) => checkPhraseFill(d, allowedWords),
      );
      return { value: finalizePhraseFill(input.text, data, allowedWords), model };
    },
  });
  return { fill: value, cached };
}
