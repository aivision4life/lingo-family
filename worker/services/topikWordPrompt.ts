// Prompt for M6.2's "tap a word" vocabulary: one call per TOPIK question, covering its whole text
// (instruction + stem + 4 options) at once, so a tap during practice never needs its own AI call.

/** Bump when the prompt or output schema changes, so old cache entries are not reused. */
export const TOPIK_VOCAB_PROMPT_VERSION = "topik-vocab-v1";

const ROLE = "You are a careful Korean-Vietnamese lexicographer helping a learner read a TOPIK II reading-test question.";

const BASIC_PARTICLES =
  "은/는, 이/가, 을/를, 도, 의, 에, 에서, 로/으로, 와/과, 하고, 만, 부터, 까지, and the plain copula 이다 ending alone";

export function buildTopikVocabPrompt(text: string) {
  const system = [
    ROLE,
    'Answer with a single JSON object {"words": [...]} that matches the given schema. No markdown, no comments.',
    "List every content word (noun, verb, adjective, adverb) and every notable grammar ending or pattern that appears in the text, in the order each first appears.",
    `Do NOT list basic grammar particles: ${BASIC_PARTICLES}.`,
    "surface: the word exactly as it appears in the text (its inflected/conjugated form, not the dictionary form).",
    "lemma: the dictionary (citation) form.",
    'pos: the most fitting part of speech ("noun", "verb", "adjective", "adverb", "pronoun", "numeral", "conjunction", "interjection", or "other" for a grammar ending/pattern that is not a single word).',
    "gloss_vi: a short, natural Vietnamese meaning (1-6 words); for a grammar ending, briefly say what it expresses in Vietnamese.",
    "List each distinct surface form only once, even if it repeats later in the text.",
  ].join("\n");
  return { system, user: text };
}
