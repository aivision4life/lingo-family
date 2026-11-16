// Pronunciation scoring: Azure's answer turned into the only shape the app and the database know
// (SPEC F5, M3.1). Pure — no fetch, no database — so every rule here is tested against the real
// bodies captured by `npm run pron-probe` (`shared/pronScore.fixtures.ts`).
//
// Azure's raw body is never stored. `details_json` holds `PronDetails` and carries its own `v`, so
// a row written today stays readable after the shape changes.
import { z } from "zod";
import { PRON_SCORE_FAIR, PRON_SCORE_GOOD } from "./pron";

/** Bumped whenever `PronDetails` changes shape. Every stored row says which version it is. */
export const PRON_DETAILS_VERSION = 1;

/** The part of Azure's answer we use. Everything else (offsets, ITN, confidences) is dropped. */
const azureSyllable = z.object({ AccuracyScore: z.number() });
const azureWord = z.object({
  Word: z.string(),
  AccuracyScore: z.number().optional(),
  ErrorType: z.string().optional(),
  Syllables: z.array(azureSyllable).optional(),
});
const azureNBest = z.object({
  PronScore: z.number(),
  AccuracyScore: z.number(),
  FluencyScore: z.number(),
  CompletenessScore: z.number(),
  Words: z.array(azureWord).optional(),
});
export const azurePronBodySchema = z.object({
  RecognitionStatus: z.string(),
  /** Signal-to-noise ratio of the take, in dB. Kept as a "the room was noisy" hint.  */
  SNR: z.number().optional(),
  NBest: z.array(azureNBest).optional(),
});

/** One Hangul letter (or any other character of the word) and its own score, where there is one. */
export type PronSyllableScore = { text: string; score: number | null };
export type PronWordScore = {
  text: string;
  score: number | null;
  /** Azure's `ErrorType`: "None", "Mispronunciation", "Omission", "Insertion", … */
  error: string;
  /** Per-letter scores, present only when they could be lined up with the text (see `alignSyllables`). */
  syllables?: PronSyllableScore[];
};
export type PronDetails = {
  v: typeof PRON_DETAILS_VERSION;
  /** Azure locale the take was scored in, e.g. `ko-KR` — the scores mean nothing without it. */
  locale: string;
  words: PronWordScore[];
  snr?: number;
};
export type PronScores = {
  pron_score: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  details: PronDetails;
};
/**
 * Why a take could not be scored, and it decides who pays for it (M3.2):
 *  - `no_result`: Azure answered 200 and heard nothing (silence, a muted microphone). Azure
 *    processed the seconds, so the quota unit is **kept** — refunding it would let a loop of
 *    silent takes call Azure without any limit.
 *  - `bad_body`: Azure answered something we cannot read, so nothing was processed for us and the
 *    unit is given back.
 */
export type PronFailureKind = "no_result" | "bad_body";
export type PronNormalized = { ok: true; scores: PronScores } | { ok: false; kind: PronFailureKind; reason: string };

const HANGUL_FIRST = 0xac00; // 가
const HANGUL_LAST = 0xd7a3; // 힣
const isHangulSyllable = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0;
  return code >= HANGUL_FIRST && code <= HANGUL_LAST;
};

/**
 * Lines Azure's `Syllables` scores up with the letters of the word — the one thing M3.0 measured
 * and the one thing that has to be re-checked at run time.
 *
 * `ko-KR` returns no syllable *names* (every `Syllable` is an empty string), but the array holds
 * **exactly one entry per Hangul letter, in order**, even where a sound change applies (`같이` → 2,
 * `먹었어요` → 4). So the scores are matched to the Hangul letters by position, and anything else in
 * the word (punctuation a typed example sentence ends with, a digit) gets no score of its own.
 *
 * Returns `null` when the counts disagree, which is the whole point of the function: the caller
 * then colours the word with its own score rather than guessing which letter was wrong. A guess
 * here would tell the learner that the wrong letter was mispronounced.
 */
export function alignSyllables(word: string, scores: number[]): PronSyllableScore[] | null {
  const chars = [...word];
  const hangul = chars.filter(isHangulSyllable);
  if (hangul.length === 0 || hangul.length !== scores.length) return null;
  let next = 0;
  return chars.map((text) => ({ text, score: isHangulSyllable(text) ? (scores[next++] ?? null) : null }));
}

/**
 * Azure's answer → `PronScores`, or a reason it cannot be scored.
 *
 * A 200 from Azure is not a score: a take that was silence, or cut off before any speech, comes
 * back `RecognitionStatus: "NoMatch"` / `"InitialSilenceTimeout"` with no `NBest`. That is a failed
 * attempt, but a paid one (`kind: "no_result"`, see `PronFailureKind`): Azure listened to those
 * seconds, so the quota unit stays spent.
 *
 * Per-letter scores are asked for Korean only. Azure returns syllable *names* for `en-US`, but they
 * are phonetic and are not pieces of the written word, so there is nothing to colour them on;
 * English degrades to one score per word, as F5 allows.
 */
export function normalizePron(raw: unknown, locale: string): PronNormalized {
  const parsed = azurePronBodySchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, kind: "bad_body", reason: `unexpected Azure body: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  const body = parsed.data;
  const best = body.NBest?.[0];
  if (!best) return { ok: false, kind: "no_result", reason: `no result (RecognitionStatus: ${body.RecognitionStatus})` };

  const perLetter = locale.startsWith("ko");
  const words: PronWordScore[] = (best.Words ?? []).map((w) => {
    const word: PronWordScore = { text: w.Word, score: w.AccuracyScore ?? null, error: w.ErrorType ?? "None" };
    const scores = perLetter && w.Syllables ? w.Syllables.map((s) => s.AccuracyScore) : null;
    const syllables = scores ? alignSyllables(w.Word, scores) : null;
    if (syllables) word.syllables = syllables;
    return word;
  });

  const details: PronDetails = { v: PRON_DETAILS_VERSION, locale, words };
  if (body.SNR !== undefined) details.snr = body.SNR;
  return {
    ok: true,
    scores: {
      pron_score: best.PronScore,
      accuracy: best.AccuracyScore,
      fluency: best.FluencyScore,
      completeness: best.CompletenessScore,
      details,
    },
  };
}

/**
 * Which colour band a score falls in (SPEC F5: green >= 80, yellow 60-79, red < 60). The two
 * numbers live in `shared/pron.ts`; this is the only place that compares against them, so no
 * component ever writes a threshold of its own.
 */
export type PronBand = "good" | "fair" | "poor" | "unknown";
export const pronBand = (score: number | null | undefined): PronBand =>
  score === null || score === undefined ? "unknown" : score >= PRON_SCORE_GOOD ? "good" : score >= PRON_SCORE_FAIR ? "fair" : "poor";

/**
 * The pieces of one word to colour: its syllables when Azure's scores could be lined up with the
 * letters (Korean, `alignSyllables`), otherwise the whole word with its own score — which is how
 * English and any Korean word whose counts disagreed degrade (F5: "use the most detailed level the
 * locale returns and degrade gracefully").
 */
export const pronWordPieces = (word: PronWordScore): PronSyllableScore[] =>
  word.syllables && word.syllables.length > 0 ? word.syllables : [{ text: word.text, score: word.score }];
