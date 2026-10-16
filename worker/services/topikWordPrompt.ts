// Prompt for M6.2's "tap a word" vocabulary: one call per TOPIK question, covering its stem and 4
// options (never the instruction line, which just repeats the question-format boilerplate and
// would add the same handful of words to every question in a block) at once, so a tap during
// practice never needs its own AI call.

/** Bump when the prompt or output schema changes, so old cache entries are not reused. */
// v2: fixed the model inventing extra meaning beyond the word's own sense, inconsistent surface
// forms for the same noun (教실에 vs 教실, 남자가/남자보다 vs 남자 — duplicate lemmas in one answer),
// and a noun's gloss absorbing its attached particle's meaning (교실 "ở phòng học" instead of
// "phòng học"). Also dropped the instruction line from the input text (v1 generated it too).
export const TOPIK_VOCAB_PROMPT_VERSION = "topik-vocab-v2";

const ROLE = "You are a careful Korean-Vietnamese lexicographer helping a learner read a TOPIK II reading-test question.";

const BASIC_PARTICLES =
  "은/는, 이/가, 을/를, 도, 의, 에, 에서, 로/으로, 와/과, 하고, 만, 부터, 까지, and the plain copula 이다 ending alone";

export function buildTopikVocabPrompt(text: string) {
  const system = [
    ROLE,
    'Answer with a single JSON object {"words": [...]} that matches the given schema. No markdown, no comments.',
    "List every content word (noun, pronoun, numeral, verb, adjective, adverb) and every notable grammar ending or particle that appears in the text, in the order each first appears.",
    `Do NOT list basic grammar particles: ${BASIC_PARTICLES}.`,
    "surface — how much of the text to include depends on the word's kind:",
    "  - Noun, pronoun or numeral: surface is the word itself only, WITHOUT any particle attached after it (e.g. \"교실\" not \"교실에\"; \"남자\" not \"남자가\" or \"남자보다\" — the particle after it, if notable, becomes its own separate entry; if not notable, per the basic-particle rule above, it is simply dropped).",
    "  - Verb or adjective: surface is its whole conjugated/inflected form exactly as it appears (e.g. \"가니까\", \"해결하는\", \"없었다\") — the ending is itself the grammar point being tested, so never trim it down to the bare stem.",
    "  - A notable grammar particle or ending on its own (comparison/dative/location particles such as 보다, 에게, 에서, or a sentence-ending grammar pattern such as -(으)십시오, -자마자): surface is just that particle/ending.",
    "lemma: the dictionary (citation) form — for a noun/pronoun/numeral this is the same as its surface (never include a particle in the lemma either). For a grammar ending/particle entry (pos \"other\" or \"particle\"), lemma is the same as its surface too — do NOT resolve a conjugated verb/adjective ending back to the main verb's dictionary form (가니까's lemma is \"가니까\", not \"가다\": the ending itself, not the verb stem, is what this entry is about).",
    "Never list the same lemma twice: if a noun appears more than once (with or without a different particle attached each time, e.g. 남자, 남자가, 남자보다), it is ONE entry, using its first occurrence as the surface.",
    'pos: the most fitting part of speech ("noun", "verb", "adjective", "adverb", "pronoun", "numeral", "particle", "conjunction", "interjection", or "other" for a grammar ending/pattern that is not a single word).',
    "gloss_vi: a short, natural Vietnamese meaning (1-6 words) of the lemma's OWN sense alone.",
    "  - Never fold a following particle's meaning into a noun's gloss (교실 = \"phòng học\", never \"ở phòng học\" — \"ở\" is 에's meaning, not 교실's).",
    "  - Never add an inferred clause, reason or outcome the word does not itself say (가니까 = \"vì đi nên\" — a cause/reason ending — never \"vì đi nên thấy\": nothing in 가니까 means \"thấy\").",
    "  - For a grammar ending/particle, state only what it itself expresses (cause, contrast, comparison, a politeness level, ...), nothing about the surrounding sentence's content.",
  ].join("\n");
  return { system, user: text };
}
