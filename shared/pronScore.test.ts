import { describe, expect, it } from "vitest";
import { AZURE_KO_SENTENCE, AZURE_KO_UNEVEN, AZURE_KO_WORD, AZURE_KO_WRONG } from "./pronScore.fixtures";
import { PRON_SCORE_FAIR, PRON_SCORE_GOOD } from "./pron";
import { alignSyllables, normalizePron, PRON_DETAILS_VERSION, pronBand, pronWordPieces } from "./pronScore";

const ok = (raw: unknown, locale = "ko-KR") => {
  const result = normalizePron(raw, locale);
  if (!result.ok) throw new Error(`expected a score, got: ${result.reason}`);
  return result.scores;
};

describe("alignSyllables", () => {
  it("gives each Hangul letter its own score, in order", () => {
    expect(alignSyllables("사과", [32, 13])).toEqual([
      { text: "사", score: 32 },
      { text: "과", score: 13 },
    ]);
  });

  it("skips what is not a Hangul letter and still lines the rest up", () => {
    expect(alignSyllables("먹어요?", [100, 90, 80])).toEqual([
      { text: "먹", score: 100 },
      { text: "어", score: 90 },
      { text: "요", score: 80 },
      { text: "?", score: null },
    ]);
  });

  it("refuses to guess when the counts disagree, in either direction", () => {
    expect(alignSyllables("사과", [99])).toBeNull();
    expect(alignSyllables("사과", [99, 99, 99])).toBeNull();
    expect(alignSyllables("사과", [])).toBeNull();
  });

  it("has nothing to align for text with no Hangul in it", () => {
    expect(alignSyllables("apple", [80, 70])).toBeNull();
  });
});

describe("normalizePron (real ko-KR bodies)", () => {
  it("keeps the four scores and the per-letter detail of a correct take", () => {
    const scores = ok(AZURE_KO_WORD);
    expect(scores).toMatchObject({ pron_score: 99.4, accuracy: 99, fluency: 100, completeness: 100 });
    expect(scores.details).toEqual({
      v: PRON_DETAILS_VERSION,
      locale: "ko-KR",
      snr: 45.684372,
      words: [
        {
          text: "사과",
          score: 99,
          error: "None",
          syllables: [
            { text: "사", score: 99 },
            { text: "과", score: 99 },
          ],
        },
      ],
    });
  });

  it("carries a wrong take's low letter scores and its error type", () => {
    const scores = ok(AZURE_KO_WRONG);
    expect(scores.pron_score).toBe(6);
    expect(scores.completeness).toBe(0);
    expect(scores.details.words[0]).toEqual({
      text: "사과",
      score: 30,
      error: "Mispronunciation",
      syllables: [
        { text: "사", score: 32 },
        { text: "과", score: 13 },
      ],
    });
  });

  it("keeps one word per whitespace-separated word of a sentence", () => {
    const scores = ok(AZURE_KO_SENTENCE);
    expect(scores.details.words.map((w) => w.text)).toEqual(["저는", "매일", "아침에", "사과를", "먹어요"]);
    expect(scores.details.words.map((w) => w.syllables?.length)).toEqual([2, 2, 3, 3, 3]);
  });

  it("does not flatten letters that scored differently inside one word", () => {
    const scores = ok(AZURE_KO_UNEVEN);
    expect(scores.details.words[1]?.syllables?.map((s) => s.score)).toEqual([100, 100, 100, 80]);
  });

  it("gives one score per word for English, where syllable names are not pieces of the word", () => {
    const raw = {
      RecognitionStatus: "Success",
      NBest: [
        {
          AccuracyScore: 90,
          FluencyScore: 88,
          CompletenessScore: 100,
          PronScore: 89,
          Words: [{ Word: "apple", AccuracyScore: 90, ErrorType: "None", Syllables: [{ AccuracyScore: 95 }, { AccuracyScore: 85 }] }],
        },
      ],
    };
    expect(ok(raw, "en-US").details.words).toEqual([{ text: "apple", score: 90, error: "None" }]);
  });

  it("colours the whole word when Azure's letter count does not match the text", () => {
    const raw = {
      RecognitionStatus: "Success",
      NBest: [
        {
          AccuracyScore: 70,
          FluencyScore: 70,
          CompletenessScore: 100,
          PronScore: 70,
          Words: [{ Word: "사과", AccuracyScore: 70, ErrorType: "None", Syllables: [{ AccuracyScore: 70 }] }],
        },
      ],
    };
    expect(ok(raw).details.words).toEqual([{ text: "사과", score: 70, error: "None" }]);
  });

  it("is not a score when Azure heard nothing, even though it answered 200", () => {
    for (const status of ["NoMatch", "InitialSilenceTimeout"]) {
      const result = normalizePron({ RecognitionStatus: status }, "ko-KR");
      expect(result).toEqual({ ok: false, kind: "no_result", reason: `no result (RecognitionStatus: ${status})` });
    }
  });

  it("refuses a body it does not understand instead of storing a wrong score", () => {
    for (const bad of [{ NBest: [{}] }, "not json at all", { RecognitionStatus: "Success", NBest: [{ PronScore: 90 }] }]) {
      const result = normalizePron(bad, "ko-KR");
      expect(result.ok).toBe(false);
      // A body we cannot read is the one failure the quota unit is given back for (M3.2).
      if (!result.ok) expect(result.kind).toBe("bad_body");
    }
  });
});

describe("colour bands (M3.2)", () => {
  it("splits at the two thresholds and says nothing about a missing score", () => {
    expect([100, PRON_SCORE_GOOD].map(pronBand)).toEqual(["good", "good"]);
    expect([PRON_SCORE_GOOD - 0.1, PRON_SCORE_FAIR].map(pronBand)).toEqual(["fair", "fair"]);
    expect([PRON_SCORE_FAIR - 0.1, 0].map(pronBand)).toEqual(["poor", "poor"]);
    expect([pronBand(null), pronBand(undefined)]).toEqual(["unknown", "unknown"]);
  });

  it("colours per syllable when they exist, and the whole word when they do not", () => {
    const syllables = [
      { text: "사", score: 99 },
      { text: "과", score: 30 },
    ];
    expect(pronWordPieces({ text: "사과", score: 60, error: "None", syllables })).toEqual(syllables);
    expect(pronWordPieces({ text: "apple", score: 85, error: "None" })).toEqual([{ text: "apple", score: 85 }]);
    // An empty array is no more detailed than the word itself, so the word wins.
    expect(pronWordPieces({ text: "apple", score: 85, error: "None", syllables: [] })).toEqual([{ text: "apple", score: 85 }]);
  });
});
