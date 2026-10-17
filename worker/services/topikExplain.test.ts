import { describe, expect, it } from "vitest";
import type { TopikOptions, TopikVocabEntry } from "../../shared/topik";
import { getDb } from "../env";
import { fakeLlm } from "../test/fakeLlm";
import { createTestEnv } from "../test/testEnv";
import {
  generateTopikExplanationWithCache,
  resolveExplainImages,
  resolveKeyTermViews,
  topikExplainCacheKey,
  topikExplainHasContent,
} from "./topikExplain";
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
    const result = await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "x", input: empty, images: [], beforeLlmCall: async () => {} });
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

    const first = await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "Test #1", input: input(), images: [], beforeLlmCall });
    expect(first).toEqual({ explanation_vi: sample.explanation_vi, key_terms: ["일어나다"], cached: false });
    expect(calls).toBe(1);
    // The invented lemma is a content problem: generateStructured retries once, still has it, and
    // the data is used as-is (M2.11 behavior) — finalize() is the safety net that filters it.
    expect(llm.requests).toHaveLength(2);

    const second = await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "Test #1", input: input(), images: [], beforeLlmCall });
    expect(second).toEqual({ ...first, cached: true });
    expect(calls).toBe(1);
    expect(llm.requests).toHaveLength(2);
    await t.dispose();
  });

  it("throws (never saves) when explanation_vi still has Hangul unrelated to this question's own words", async () => {
    const t = await createTestEnv();
    // "학생" is not one of input()'s vocab entries (only "일어나서"/"일어나다"), so it is a genuine leak.
    const sample = { explanation_vi: "Dùng 학생 ở đây.", key_terms: ["일어나다"] };
    const llm = fakeLlm([JSON.stringify(sample)]);
    const db = getDb(t.env);
    await expect(
      generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "Test #1", input: input(), images: [], beforeLlmCall: async () => {} }),
    ).rejects.toThrow(/script problem/);
    await t.dispose();
  });

  it("accepts naming a grammar pattern or quoting a word that is one of this question's own vocab entries", async () => {
    const t = await createTestEnv();
    // "일어나다" is input()'s own vocab lemma, so quoting it in Hangul is allowed, not a leak.
    const sample = { explanation_vi: "Từ 일어나다 nghĩa là thức dậy.", key_terms: ["일어나다"] };
    const llm = fakeLlm([JSON.stringify(sample)]);
    const db = getDb(t.env);
    const result = await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "x", input: input(), images: [], beforeLlmCall: async () => {} });
    expect(result.explanation_vi).toBe(sample.explanation_vi);
    expect(llm.requests).toHaveLength(1); // no retry needed: accepted on the first try
    await t.dispose();
  });

  it("forwards the resolved images into the LLM request", async () => {
    const t = await createTestEnv();
    const sample = { explanation_vi: "Giải thích.", key_terms: [] };
    const llm = fakeLlm([JSON.stringify(sample)]);
    const db = getDb(t.env);
    const images = [{ label: "Hình ảnh đề bài:", mimeType: "image/webp", data: "AAA=" }];
    await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "x", input: input(), images, beforeLlmCall: async () => {} });
    expect(llm.requests[0]!.images).toEqual(images);
    await t.dispose();
  });

  it("accepts the model quoting the stem's own underlined phrase (M6.5-ish), even though it is not in vocab", async () => {
    const t = await createTestEnv();
    const withUnderline = input({ stem: { text: "어제 본 공연은 눈물이 <u>날 정도로</u> 감동적이었다.", image_key: null } });
    // "날 정도로" is the underlined phrase, not a vocab entry's surface/lemma (only "일어나서"/"일어나다") —
    // without the fix, quoting it would be flagged as unexpected Hangul.
    const sample = { explanation_vi: "Đáp án đúng gần nghĩa với 날 정도로.", key_terms: ["일어나다"] };
    const llm = fakeLlm([JSON.stringify(sample)]);
    const db = getDb(t.env);
    const result = await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "x", input: withUnderline, images: [], beforeLlmCall: async () => {} });
    expect(result.explanation_vi).toBe(sample.explanation_vi);
    expect(llm.requests).toHaveLength(1); // accepted first try, no retry needed
    await t.dispose();
  });

  it("tells the model what <u>…</u> in the stem means, only when the stem actually has it", async () => {
    const t = await createTestEnv();
    const sample = { explanation_vi: "Giải thích.", key_terms: [] };
    const llm = fakeLlm([JSON.stringify(sample), JSON.stringify(sample)]);
    const db = getDb(t.env);

    const withUnderline = input({ stem: { text: "어제 <u>날 정도로</u> 감동적이었다.", image_key: null } });
    await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "a", input: withUnderline, images: [], beforeLlmCall: async () => {} });
    expect(llm.requests[0]!.system).toContain("<u>");

    await generateTopikExplanationWithCache({ db, llm: llm.client, logContext: "b", input: input(), images: [], beforeLlmCall: async () => {} });
    expect(llm.requests[1]!.system).not.toContain("<u>");
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
      images: [],
      beforeLlmCall: async () => {},
    });
    expect(result.key_terms).toEqual(["w0", "w1", "w2", "w3", "w4"]);
  });
});

describe("resolveExplainImages", () => {
  const fakeBucket = (objects: Record<string, { bytes: Uint8Array; contentType?: string }>): R2Bucket =>
    ({
      get: async (key: string) => {
        const o = objects[key];
        if (!o) return null;
        return { arrayBuffer: async () => o.bytes.buffer, httpMetadata: { contentType: o.contentType } };
      },
    }) as unknown as R2Bucket;

  it("returns [] when neither the stem nor any option has an image", async () => {
    const result = await resolveExplainImages(fakeBucket({}), { stem: { image_key: null }, options: options(["a", "b", "c", "d"]) });
    expect(result).toEqual({ images: [] });
  });

  it("fetches and labels the stem image and every option image, in order", async () => {
    const bucket = fakeBucket({
      stemKey: { bytes: new Uint8Array([1, 2]), contentType: "image/webp" },
      opt2Key: { bytes: new Uint8Array([3, 4]), contentType: "image/png" },
    });
    const result = await resolveExplainImages(bucket, {
      stem: { image_key: "stemKey" },
      options: [
        { text: "a", image_key: null },
        { text: null, image_key: "opt2Key" },
        { text: "c", image_key: null },
        { text: "d", image_key: null },
      ] as unknown as TopikOptions,
    });
    expect("images" in result && result.images.map((i) => i.label)).toEqual(["Hình ảnh đề bài:", "Hình ảnh đáp án 2:"]);
    expect("images" in result && result.images[1]!.mimeType).toBe("image/png");
  });

  it("returns an error (nothing partial) when a referenced image can't be fetched from R2", async () => {
    const result = await resolveExplainImages(fakeBucket({}), { stem: { image_key: "missing" }, options: options(["a", "b", "c", "d"]) });
    expect(result).toEqual({ error: "image missing not found in R2" });
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
