import { describe, expect, it } from "vitest";
import type { TopikOptions, TopikVocabEntry } from "../../shared/topik";
import { getDb } from "../env";
import { fakeLlm } from "../test/fakeLlm";
import { createTestEnv } from "../test/testEnv";
import { generateTopikExplanationWithCache, resolveKeyTermViews, topikExplainCacheKey, topikExplainHasContent } from "./topikExplain";
import type { ExplainInput } from "./topikExplainPrompt";

const options = (texts: (string | null)[]): TopikOptions =>
  texts.map((text) => ({ text, image_key: text === null ? "k" : null })) as unknown as TopikOptions;

const vocabEntry = (over: Partial<TopikVocabEntry> = {}): TopikVocabEntry => ({
  surface: "일어나서",
  lemma: "일어나다",
  pos: "verb",
  gloss_vi: "thức dậy",
  ...over,
});

const input = (over: Partial<ExplainInput> = {}): ExplainInput => ({
  instruction: "가장 알맞은 것을 고르십시오.",
  stem: { text: "아침에 (   ) 전화를 드렸다.", image_key: null },
  options: options(["일어나서", "일어나는데", "일어나자마자", "일어나고"]),
  correct_option: 1,
  vocab: [vocabEntry()],
  ...over,
});

describe("topikExplainHasContent", () => {
  it("is true when there is any text in instruction/stem/options", () => {
    expect(topikExplainHasContent(input())).toBe(true);
  });

  it("is false for a fully image-only question", () => {
    const empty = input({ instruction: null, stem: { text: null, image_key: "k" }, options: options([null, null, null, null]) });
    expect(topikExplainHasContent(empty)).toBe(false);
  });
});

describe("topikExplainCacheKey", () => {
  it("is stable and changes with the model, correct_option or vocab", async () => {
    const key = await topikExplainCacheKey("m1", input());
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await topikExplainCacheKey("m1", input())).toBe(key);
    expect(await topikExplainCacheKey("m2", input())).not.toBe(key);
    expect(await topikExplainCacheKey("m1", input({ correct_option: 2 }))).not.toBe(key);
    expect(await topikExplainCacheKey("m1", input({ vocab: [] }))).not.toBe(key);
  });
});

describe("generateTopikExplanationWithCache", () => {
  it("returns null/[] without ever calling the LLM when there is nothing to explain", async () => {
    const t = await createTestEnv();
    const llm = fakeLlm(["should not be used"]);
    const db = getDb(t.env);
    const empty = input({ instruction: null, stem: { text: null, image_key: "k" }, options: options([null, null, null, null]) });
    const result = await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "x", input: empty, beforeLlmCall: async () => {} });
    expect(result).toEqual({ explanation_vi: null, key_terms: [], cached: true });
    expect(llm.requests).toHaveLength(0);
    await t.dispose();
  });

  it("filters out an invented key_term lemma and caches the cleaned result", async () => {
    const t = await createTestEnv();
    const sample = { explanation_vi: "Vì động từ chia đúng thì.", key_terms: ["일어나다", "없다"] }; // "없다" is not in this question's vocab
    const llm = fakeLlm([JSON.stringify(sample)]);
    const db = getDb(t.env);
    let calls = 0;
    const beforeLlmCall = async () => void calls++;

    const first = await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "Test #1", input: input(), beforeLlmCall });
    expect(first).toEqual({ explanation_vi: sample.explanation_vi, key_terms: ["일어나다"], cached: false });
    expect(calls).toBe(1);
    // The invented lemma is a content problem: generateStructured retries once, still has it, and
    // the data is used as-is (M2.11 behavior) — finalize() is the safety net that filters it.
    expect(llm.requests).toHaveLength(2);

    const second = await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "Test #1", input: input(), beforeLlmCall });
    expect(second).toEqual({ ...first, cached: true });
    expect(calls).toBe(1);
    expect(llm.requests).toHaveLength(2);
    await t.dispose();
  });

  it("throws (never saves) when explanation_vi still has a script problem after the retry", async () => {
    const t = await createTestEnv();
    const sample = { explanation_vi: "Dùng 일어나다 ở đây.", key_terms: ["일어나다"] };
    const llm = fakeLlm([JSON.stringify(sample)]);
    const db = getDb(t.env);
    await expect(
      generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "Test #1", input: input(), beforeLlmCall: async () => {} }),
    ).rejects.toThrow(/script problem/);
    await t.dispose();
  });

  it("dedupes a repeated key_term lemma and caps at 5", async () => {
    const t = await createTestEnv();
    const vocab = Array.from({ length: 7 }, (_, i) => vocabEntry({ surface: `w${i}`, lemma: `w${i}` }));
    const sample = { explanation_vi: "Giải thích.", key_terms: ["w0", "w0", "w1", "w2", "w3", "w4", "w5", "w6"] };
    const llm = fakeLlm([JSON.stringify(sample)]);
    const db = getDb(t.env);
    const result = await generateTopikExplanationWithCache({
      db,
      llm: llm.client,
      logContext: "x",
      input: input({ vocab }),
      beforeLlmCall: async () => {},
    });
    expect(result.key_terms).toEqual(["w0", "w1", "w2", "w3", "w4"]);
  });
});

describe("resolveKeyTermViews", () => {
  it("always includes a grammar entry (no library lookup needed)", async () => {
    const t = await createTestEnv();
    const db = getDb(t.env);
    const grammar = vocabEntry({ surface: "가니까", lemma: "가니까", pos: "other", gloss_vi: "vì nên" });
    const views = await resolveKeyTermViews(db, "p1", [grammar], ["가니까"]);
    expect(views).toEqual([{ lemma: "가니까", pos: "other", gloss_vi: "vì nên", existing_word_id: null }]);
    await t.dispose();
  });

  it("marks a term not in the library as new, orders grammar before new before weak, and caps at 5", async () => {
    const t = await createTestEnv();
    const db = getDb(t.env);
    const grammar = vocabEntry({ surface: "가니까", lemma: "가니까", pos: "other", gloss_vi: "vì nên" });
    const newWord = vocabEntry({ surface: "전화", lemma: "전화", pos: "noun", gloss_vi: "điện thoại" });
    const views = await resolveKeyTermViews(db, "p1", [grammar, newWord], ["전화", "가니까"]);
    expect(views).toEqual([
      { lemma: "가니까", pos: "other", gloss_vi: "vì nên", existing_word_id: null },
      { lemma: "전화", pos: "noun", gloss_vi: "điện thoại", existing_word_id: null },
    ]);
    await t.dispose();
  });

  it("ignores a key_terms lemma that isn't actually in the question's own vocab", async () => {
    const t = await createTestEnv();
    const db = getDb(t.env);
    const views = await resolveKeyTermViews(db, "p1", [vocabEntry({ lemma: "일어나다" })], ["없다"]);
    expect(views).toEqual([]);
    await t.dispose();
  });
});
