// Pure parts of the one-off TOPIK podcast TTS batch (M8.1): no D1, no R2, no Azure here.
import { podcastSpeech, podcastSpeechLength, type PodcastSpeech } from "../../shared/podcast";
import { PODCAST_FIRST_SPEAKABLE_NUMBER } from "../../shared/podcast";
import type { TopikOptions } from "../../shared/topik";

export type PodcastRow = {
  id: string;
  exam: string;
  number: number;
  instruction: string | null;
  options: TopikOptions;
  correct_option: number;
};

/** One file to synthesise: the text, and the questions that will play it. */
export type SpeechItem = { text: string; questions: number };

/**
 * Every distinct piece of speech the whole bank needs, and how often it is used.
 *
 * Distinct is the point. The question number is the same four syllables for every paper's
 * question 12, and a block's question line is shared by its whole block and usually by the same
 * block in every other paper — on the real bank that is 69 question lines for 376 questions. The
 * R2 key is the hash of the text (`audioKey`), so those files are generated once and found again
 * by everyone: counting per question instead would pay Azure three times for the same audio.
 */
export function planSpeech(rows: readonly PodcastRow[]): { items: SpeechItem[]; skipped: PodcastRow[] } {
  const byText = new Map<string, SpeechItem>();
  const skipped: PodcastRow[] = [];

  for (const row of rows) {
    // Questions 1-3 answer with pictures; anything else unspeakable is skipped the same way, and
    // the podcast leaves those questions out too, so no file is ever made for half a question.
    if (row.number < PODCAST_FIRST_SPEAKABLE_NUMBER) {
      skipped.push(row);
      continue;
    }
    const speech = podcastSpeech(row);
    if (!speech) {
      skipped.push(row);
      continue;
    }
    for (const text of texts(speech)) {
      const item = byText.get(text);
      if (item) item.questions += 1;
      else byText.set(text, { text, questions: 1 });
    }
  }
  return { items: [...byText.values()], skipped };
}

export const texts = (s: PodcastSpeech): string[] => [s.number, s.questionLine, s.options, s.answer];

/** Characters Azure would be billed for, which is what the owner is told before a real run. */
export const totalCharacters = (items: readonly SpeechItem[]) => items.reduce((n, i) => n + i.text.length, 0);

/** What the same bank would have cost with no sharing — the number F13 estimated (~210/question). */
export const charactersPerQuestion = (rows: readonly PodcastRow[]) =>
  rows.reduce((n, row) => {
    const speech = podcastSpeech(row);
    return speech ? n + podcastSpeechLength(speech) : n;
  }, 0);

// --- pacing Azure ------------------------------------------------------------------------------

/**
 * Azure's free F0 tier allows **20 neural-voice requests a minute**, so the batch paces itself at
 * one call every 3.2 seconds rather than finding the limit by hitting it. 850 files take about
 * three quarters of an hour, which is fine for something run once.
 */
export const F0_MIN_INTERVAL_MS = 3_200;

/** A 429 from Azure: the one failure that means "slow down", not "this will never work". */
export const isRateLimited = (message: string) => message.includes("429");

/**
 * How long to wait before attempt `n` (1-based) of the same file: 10 s, 20 s, 40 s, 80 s.
 *
 * Doubling, and capped at four tries — a tier that is still refusing after two and a half minutes
 * of backing off is not going to be talked round by a fifth attempt, and the run stops there so
 * the owner can see it instead of a log that scrolled past hours ago.
 */
export const RATE_LIMIT_ATTEMPTS = 4;
export const rateLimitDelayMs = (attempt: number) => 10_000 * 2 ** Math.max(0, attempt - 1);
