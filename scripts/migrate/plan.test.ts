import { describe, expect, it } from "vitest";
import { countByTable, planContent, type LocalContent, type RemoteContent } from "./plan";

let n = 0;
const newId = () => `gen-${++n}`;
const word = (id: string, term: string, lang = "ko") => ({ id, lang, term, created_by_profile: "p-local" });
const phrase = (id: string, word_id: string, text: string, lang = "ko") => ({ id, word_id, lang, text, created_by_profile: "p-local" });
const example = (id: string, word_id: string, sentence: string, phrase_id: string | null = null) => ({ id, word_id, phrase_id, sentence });

const emptyLocal: LocalContent = { words: [], phrases: [], examples: [], han_chars: [], word_chars: [], ai_cache: [] };
const emptyRemote: RemoteContent = { words: [], phrases: [], exampleIds: [], hanjas: [], wordCharKeys: [], aiCacheKeys: [] };

const local: LocalContent = {
  words: [word("w1", "학생"), word("w2", "학교"), word("w3", "Apple", "en")],
  phrases: [phrase("p1", "w1", "대학생"), phrase("p2", "w2", "학교생활")],
  examples: [example("e1", "w1", "저는 학생이에요"), example("e2", "w1", "대학생이에요", "p1"), example("e3", "w2", "학교에 가요")],
  han_chars: [{ hanja: "學" }, { hanja: "校" }],
  word_chars: [
    { word_id: "w1", position: 0, hanja: "學" },
    { word_id: "w2", position: 0, hanja: "學" },
  ],
  ai_cache: [{ key: "k1" }, { key: "k2" }],
};

describe("planContent", () => {
  it("moves everything to an empty production, with profile references set to NULL", () => {
    const plan = planContent(local, emptyRemote, newId);
    expect(countByTable(plan)).toEqual({ words: 3, phrases: 2, examples: 3, han_chars: 2, word_chars: 2, ai_cache: 2 });
    expect(plan.words.every((w) => w.created_by_profile === null)).toBe(true);
    expect(plan.phrases.every((p) => p.created_by_profile === null)).toBe(true);
    expect(plan.skipped).toEqual([]);
  });

  it("keeps production rows and re-parents new phrases onto the production word", () => {
    const remote: RemoteContent = {
      ...emptyRemote,
      words: [{ id: "prod-w1", lang: "ko", term: "학생" }],
      phrases: [{ id: "prod-p1", lang: "ko", text: "대학생" }],
      exampleIds: ["prod-e1"],
      hanjas: ["學"],
      aiCacheKeys: ["k1"],
    };
    // 학생 also has a local phrase that production lacks.
    const withExtra: LocalContent = { ...local, phrases: [...local.phrases, phrase("p3", "w1", "학생증")] };
    const plan = planContent(withExtra, remote, newId);

    expect(plan.words.map((w) => w.term)).toEqual(["학교", "Apple"]); // 학생 skipped
    expect(plan.phrases.map((p) => [p.text, p.word_id])).toEqual([
      ["학교생활", "w2"],
      ["학생증", "prod-w1"],
    ]);
    // Examples of 학생 and 대학생 (production owners) are skipped; 학교's example is moved.
    expect(plan.examples.map((e) => e.id)).toEqual(["e3"]);
    // word_chars of the skipped word are skipped; han_chars / ai_cache already present are skipped.
    expect(plan.word_chars.map((c) => c.word_id)).toEqual(["w2"]);
    expect(plan.han_chars.map((h) => h.hanja)).toEqual(["校"]);
    expect(plan.ai_cache.map((c) => c.key)).toEqual(["k2"]);
    expect(plan.wordStatus.find((w) => w.term === "학생")?.status).toBe("exists-in-production");
    expect(plan.skipped.some((s) => s.table === "words" && s.label === "ko 학생")).toBe(true);
  });

  it("treats English terms case-insensitively", () => {
    const remote: RemoteContent = { ...emptyRemote, words: [{ id: "prod-a", lang: "en", term: "apple" }] };
    const plan = planContent(local, remote, newId);
    expect(plan.words.map((w) => w.term)).not.toContain("Apple");
  });

  it("is idempotent: planning against the result of a run plans nothing", () => {
    const first = planContent(local, emptyRemote, newId);
    const after: RemoteContent = {
      words: first.words.map((w) => ({ id: w.id as string, lang: w.lang as "ko", term: w.term as string })),
      phrases: first.phrases.map((p) => ({ id: p.id as string, lang: p.lang as "ko", text: p.text as string })),
      exampleIds: first.examples.map((e) => e.id as string),
      hanjas: first.han_chars.map((h) => h.hanja as string),
      wordCharKeys: first.word_chars.map((c) => `${c.word_id}:${c.position}`),
      aiCacheKeys: first.ai_cache.map((c) => c.key as string),
    };
    const again = planContent(local, after, newId);
    expect(countByTable(again)).toEqual({ words: 0, phrases: 0, examples: 0, han_chars: 0, word_chars: 0, ai_cache: 0 });
    expect(again.wordStatus.every((w) => w.status === "already-migrated")).toBe(true);
  });

  it("completes a half-finished run: examples missing under an already-moved word are added", () => {
    const remote: RemoteContent = { ...emptyRemote, words: [{ id: "w1", lang: "ko", term: "학생" }] }; // same id: moved earlier
    const plan = planContent({ ...emptyLocal, words: [word("w1", "학생")], examples: [example("e1", "w1", "x")] }, remote, newId);
    expect(plan.words).toEqual([]);
    expect(plan.examples.map((e) => e.id)).toEqual(["e1"]);
  });

  it("gives a new id when a local id is taken by a different production row", () => {
    const remote: RemoteContent = { ...emptyRemote, words: [{ id: "w1", lang: "ko", term: "다른" }] };
    const plan = planContent({ ...emptyLocal, words: [word("w1", "학생")], examples: [example("e1", "w1", "x")] }, remote, newId);
    expect(plan.words[0]?.id).toMatch(/^gen-/);
    expect(plan.examples[0]?.word_id).toBe(plan.words[0]?.id);
  });
});
