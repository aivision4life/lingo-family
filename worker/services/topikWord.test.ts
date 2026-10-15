import { describe, expect, it } from "vitest";
import type { TopikOptions } from "../../shared/topik";
import { getDb } from "../env";
import { fakeLlm } from "../test/fakeLlm";
import { createTestEnv } from "../test/testEnv";
import { generateTopikVocabWithCache, topikQuestionFullText, topikVocabCacheKey } from "./topikWord";

const options = (texts: (string | null)[]): TopikOptions =>
  texts.map((text) => ({ text, image_key: text === null ? "k" : null })) as unknown as TopikOptions;

describe("topikQuestionFullText", () => {
  it("joins instruction, stem and option texts, skipping null/empty ones", () => {
    const text = topikQuestionFullText({
      instruction: "가장 알맞은 것을 고르십시오.",
      stem_text: "아침에 (   ) 전화를 드렸다.",
      options: options(["일어나서", null, "", "일어나고"]),
    });
    expect(text).toBe("가장 알맞은 것을 고르십시오.\n아침에 (   ) 전화를 드렸다.\n일어나서\n일어나고");
  });

  it("is empty for an image-only question (nothing to tokenize)", () => {
    const text = topikQuestionFullText({ instruction: null, stem_text: null, options: options([null, null, null, null]) });
    expect(text).toBe("");
  });
});

describe("topikVocabCacheKey", () => {
  it("is stable and changes with the model or the text", async () => {
    const key = await topikVocabCacheKey("m1", "텍스트");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await topikVocabCacheKey("m1", "텍스트")).toBe(key);
    expect(await topikVocabCacheKey("m2", "텍스트")).not.toBe(key);
    expect(await topikVocabCacheKey("m1", "다른 텍스트")).not.toBe(key);
  });
});

describe("generateTopikVocabWithCache", () => {
  it("returns [] without ever calling the LLM for empty text (M6.2: an image-only question)", async () => {
    const t = await createTestEnv();
    const llm = fakeLlm(["should not be used"]);
    const db = getDb(t.env);
    const result = await generateTopikVocabWithCache({ db, llm: llm.client, logContext: "x", text: "   ", beforeLlmCall: async () => {} });
    expect(result).toEqual({ vocab: [], cached: true });
    expect(llm.requests).toHaveLength(0);
    await t.dispose();
  });

  it("drops an entry with a script problem, keeps the rest, and caches the result (ai_cache)", async () => {
    const t = await createTestEnv();
    const sample = {
      words: [
        { surface: "일어나서", lemma: "일어나다", pos: "verb", gloss_vi: "thức dậy" },
        // Hangul inside a Vietnamese gloss: fails checkVietnameseText, dropped (M2.11-style check).
        { surface: "전화", lemma: "전화", pos: "noun", gloss_vi: "학생" },
      ],
    };
    const llm = fakeLlm([JSON.stringify(sample)]);
    const db = getDb(t.env);
    let calls = 0;
    const beforeLlmCall = async () => void calls++;

    const first = await generateTopikVocabWithCache({
      db,
      llm: llm.client,
      logContext: "Test #1",
      text: "아침에 전화를 드렸다.",
      beforeLlmCall,
    });
    expect(first).toEqual({ vocab: [{ surface: "일어나서", lemma: "일어나다", pos: "verb", gloss_vi: "thức dậy" }], cached: false });
    expect(calls).toBe(1);
    // The dropped entry is a content problem (not a schema failure): generateStructured retries
    // once with it flagged, still fails to fix it, and returns the data as-is (M2.11 behavior).
    expect(llm.requests).toHaveLength(2);

    // Same text again: cache hit, no new LLM call (and beforeLlmCall, which logs usage, is skipped).
    const second = await generateTopikVocabWithCache({
      db,
      llm: llm.client,
      logContext: "Test #1",
      text: "아침에 전화를 드렸다.",
      beforeLlmCall,
    });
    expect(second).toEqual({ vocab: first.vocab, cached: true });
    expect(calls).toBe(1);
    expect(llm.requests).toHaveLength(2);
    await t.dispose();
  });
});
