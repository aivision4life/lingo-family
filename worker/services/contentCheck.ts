// Script sanity checks for LLM-generated language text (M2.11): the JSON-schema check only
// enforces shape/non-empty, not script — it missed a stray Latin letter inside a Korean sentence
// ("이야기에 a 빠져들다 보니..."). These are plain pure checks, reused both to decide whether to
// retry a generation and, afterwards, to drop just the offending example/phrase.
import type { LearnLang } from "../../shared/enums";
import type { LlmSentence } from "../../shared/base";
import type { LlmEnrichment } from "../../shared/word";
import type { LlmPhrase } from "../../shared/phrase";
import type { LlmSentenceCheck } from "../../shared/customItem";
import type { TopikVocabEntry } from "../../shared/topik";

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
/** Han ideographs (Chinese/Hanja) and Japanese kana — never expected outside the dedicated Hanja field. */
const HAN_OR_KANA = /[㐀-䶿一-鿿぀-ゟ゠-ヿ]/;
const LATIN_WORD = /[A-Za-z]+/g;

/** Any quốc ngữ tone/vowel mark, including đ/Đ. */
const VIETNAMESE_DIACRITIC = /[àáạảãăằắặẳẵâầấậẩẫèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
/** Below this length, having no diacritic at all is not suspicious — a short phrase, a proper
 * noun, a number, an acronym. Only flag text long enough that it really should read as accented
 * Vietnamese prose. */
const VIETNAMESE_DIACRITIC_MIN_LENGTH = 50;

/**
 * Flags Vietnamese prose written with the diacritics stripped out entirely ("Cau hoi yeu cau tim
 * bieu thuc..." instead of "Câu hỏi yêu cầu tìm biểu thức..."): still genuinely Latin-only text (so
 * `checkVietnameseText`'s Hangul check alone would not catch it), barely readable, and — seen in
 * practice under heavy Gemini 429/503 retry pressure — not something the schema check notices
 * either, since it is syntactically a perfectly valid string. A short string legitimately has
 * nothing to put a mark on (a lone proper noun, a number), so this only looks at text long enough
 * to be real prose.
 */
export function checkVietnameseDiacritics(text: string): string[] {
  if (text.length < VIETNAMESE_DIACRITIC_MIN_LENGTH) return [];
  return VIETNAMESE_DIACRITIC.test(text) ? [] : ["Vietnamese text has no diacritics at all (likely generated with accents stripped)"];
}

/** Common loanword acronyms that legitimately appear as-is inside Korean text. */
const KOREAN_LATIN_ALLOWLIST = new Set(["TV", "AI", "PC", "CD", "DVD", "SNS", "PDF", "URL", "ID", "OK", "DIY", "VIP", "USB"]);

/**
 * Korean text should be Hangul (plus digits/punctuation): flags a Latin letter run unless it is a
 * known loanword acronym (`KOREAN_LATIN_ALLOWLIST`) or in `allowedWords` (e.g. the term itself,
 * when the item being studied is written in Latin script), and flags stray Han/Kana characters
 * (never expected here — Hanja has its own field). A **lone single Latin letter is always wrong**:
 * that is the exact shape of the bug this was written for.
 */
export function checkKoreanText(text: string, allowedWords: readonly string[] = []): string[] {
  const allow = new Set(allowedWords.map((w) => w.toUpperCase()));
  const problems: string[] = [];
  for (const [word] of text.matchAll(LATIN_WORD)) {
    if (word.length === 1) problems.push(`a lone Latin letter "${word}"`);
    else if (!KOREAN_LATIN_ALLOWLIST.has(word.toUpperCase()) && !allow.has(word.toUpperCase())) problems.push(`a Latin word "${word}"`);
  }
  if (HAN_OR_KANA.test(text)) problems.push("Chinese/Japanese characters outside the Hanja field");
  return problems;
}

/** English text should not contain Hangul or Han/Kana. */
export function checkEnglishText(text: string): string[] {
  const problems: string[] = [];
  if (HANGUL.test(text)) problems.push("Hangul in English text");
  if (HAN_OR_KANA.test(text)) problems.push("Chinese/Japanese characters in English text");
  return problems;
}

/** Vietnamese text should not contain Hangul, and (if long enough to be real prose) should have at
 * least one diacritic mark. */
export function checkVietnameseText(text: string): string[] {
  const problems: string[] = [];
  if (HANGUL.test(text)) problems.push("Hangul in Vietnamese text");
  problems.push(...checkVietnameseDiacritics(text));
  return problems;
}

/** Picks the Korean or English check for a learning-language field (word term, phrase text, sentence). */
export function checkLangText(lang: LearnLang, text: string, allowedWords?: readonly string[]): string[] {
  return lang === "ko" ? checkKoreanText(text, allowedWords) : checkEnglishText(text);
}

const prefixed = (prefix: string, problems: string[]) => problems.map((p) => `${prefix}: ${p}`);

/**
 * One example sentence: the sentence itself (checked against `lang`) plus every translation that
 * is not the sentence's own language. The sentence's own-language translation is never checked —
 * the LLM is told to leave it "" and the server discards whatever it actually put there (M2.11:
 * checking it caused false positives, e.g. a one-character placeholder read as a stray Latin letter).
 */
export function checkSentence(lang: LearnLang, s: LlmSentence, allowedWords?: readonly string[]): string[] {
  const problems = prefixed("sentence", checkLangText(lang, s.sentence, allowedWords));
  if (s.translation_vi) problems.push(...prefixed("translation_vi", checkVietnameseText(s.translation_vi)));
  if (lang !== "en" && s.translation_en) problems.push(...prefixed("translation_en", checkEnglishText(s.translation_en)));
  if (lang !== "ko" && s.translation_ko) problems.push(...prefixed("translation_ko", checkKoreanText(s.translation_ko, allowedWords)));
  return problems;
}

/**
 * The vi/en/ko meaning triple present on words and phrases. `allowedWords` matters for `gloss_ko`
 * when the item being studied is itself written in Latin script (lang=en): its Korean meaning may
 * reasonably keep the term as a loanword.
 */
export function checkGlosses(g: { gloss_vi: string; gloss_en: string; gloss_ko: string }, allowedWords?: readonly string[]): string[] {
  return [
    ...prefixed("gloss_vi", checkVietnameseText(g.gloss_vi)),
    ...prefixed("gloss_en", checkEnglishText(g.gloss_en)),
    ...prefixed("gloss_ko", checkKoreanText(g.gloss_ko, allowedWords)),
  ];
}

/** One suggested phrase: its text, glosses and own example sentence. */
export function checkPhrase(lang: LearnLang, p: LlmPhrase, allowedWords?: readonly string[]): string[] {
  return [
    ...prefixed("text", checkLangText(lang, p.text, allowedWords)),
    ...checkGlosses(p, allowedWords),
    ...prefixed("example", checkSentence(lang, p.example, allowedWords)),
  ];
}

/**
 * The whole word-enrichment answer (gloss + every example + every suggested phrase), for deciding
 * whether to ask the model to redo its answer. Prefixed with the array index so a caller could
 * in principle tell which item is at fault, though the finalize step re-checks each item itself.
 */
export function checkEnrichment(
  lang: LearnLang,
  data: Pick<LlmEnrichment, "gloss_vi" | "gloss_en" | "gloss_ko" | "examples" | "phrases">,
  allowedWords?: readonly string[],
): string[] {
  return [
    ...checkGlosses(data, allowedWords),
    ...data.examples.flatMap((e, i) => prefixed(`examples[${i}]`, checkSentence(lang, e, allowedWords))),
    ...data.phrases.flatMap((p, i) => prefixed(`phrases[${i}]`, checkPhrase(lang, p, allowedWords))),
  ];
}

/** Checks every LLM-generated text in a "check my sentence" answer (M2.6): translations, the
 * suggested rewrite (if any) and its translations, and the Vietnamese reason. */
export function checkSentenceCheck(lang: LearnLang, data: LlmSentenceCheck, allowedWords?: readonly string[]): string[] {
  const own: LlmSentence = {
    sentence: "", // the user's own text, not LLM output: not checked here
    translation_vi: data.translation_vi,
    translation_en: data.translation_en,
    translation_ko: data.translation_ko,
    image_prompt: "x",
  };
  const problems = checkSentence(lang, own, allowedWords).filter((p) => !p.startsWith("sentence:"));
  if (data.suggestion) {
    const suggestion: LlmSentence = {
      sentence: data.suggestion,
      translation_vi: data.suggestion_translation_vi,
      translation_en: data.suggestion_translation_en,
      translation_ko: data.suggestion_translation_ko,
      image_prompt: "x",
    };
    problems.push(...prefixed("suggestion", checkSentence(lang, suggestion, allowedWords)));
  }
  if (data.note_vi) problems.push(...prefixed("note_vi", checkVietnameseText(data.note_vi)));
  return problems;
}

/** Checks the gloss triple filled in for a user-typed phrase (M2.6; no text/example to check here). */
export function checkPhraseFill(data: { gloss_vi: string; gloss_en: string; gloss_ko: string }, allowedWords?: readonly string[]): string[] {
  return checkGlosses(data, allowedWords);
}

/** One AI-generated vocabulary entry for a TOPIK question (M6.2): `surface`/`lemma` are Korean, `gloss_vi` is Vietnamese. */
export function checkTopikVocabEntry(e: Pick<TopikVocabEntry, "surface" | "lemma" | "gloss_vi">): string[] {
  return [
    ...prefixed("surface", checkKoreanText(e.surface)),
    ...prefixed("lemma", checkKoreanText(e.lemma)),
    ...prefixed("gloss_vi", checkVietnameseText(e.gloss_vi)),
  ];
}

/** A Hangul run (optionally grammar-notation-prefixed with a hyphen, e.g. "-느라고"). */
const HANGUL_RUN = /-?[가-힣ᄀ-ᇿ㄰-㆏]+/g;

/**
 * A TOPIK answer explanation (M6.3): `explanation_vi` is Vietnamese, but — unlike the general-
 * purpose `checkVietnameseText` — is explicitly allowed to name a grammar pattern or quote a word
 * in Hangul (e.g. "-느라고", or "건물"), since M6.3 requires naming the exact pattern being tested
 * rather than writing vaguely about "this structure". A Hangul run is only accepted when it is a
 * substring of (or contains as a substring) one of this question's own `vocab` surface/lemma
 * forms, given in `allowedHangul` — never a free-form Korean sentence the model wrote instead of
 * translating. Chinese/Japanese characters are never allowed (no legitimate reason to appear here).
 * `key_terms` must be a subset of `allowedLemmas` (the question's own `vocab`): the model is told
 * to pick only from that list, never invent a new one, and this is the check that catches it if it
 * does anyway.
 */
export function checkTopikExplanation(
  data: { explanation_vi: string; key_terms: string[] },
  allowedLemmas: readonly string[],
  allowedHangul: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  for (const run of data.explanation_vi.match(HANGUL_RUN) ?? []) {
    const stripped = run.replace(/^-/, "");
    const known = allowedHangul.some((t) => t.includes(stripped) || stripped.includes(t));
    if (!known) problems.push(`explanation_vi: unexpected Hangul "${run}" (not one of this question's own words/patterns)`);
  }
  if (HAN_OR_KANA.test(data.explanation_vi)) problems.push("explanation_vi: Chinese/Japanese characters in Vietnamese text");
  problems.push(...checkVietnameseDiacritics(data.explanation_vi).map((p) => `explanation_vi: ${p}`));

  const allowed = new Set(allowedLemmas);
  const unknown = data.key_terms.filter((l) => !allowed.has(l));
  if (unknown.length > 0) problems.push(`key_terms: lemma(s) not in this question's vocabulary: ${unknown.join(", ")}`);
  return problems;
}
