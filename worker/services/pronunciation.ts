// Pronunciation Assessment behind a small interface (Azure Speech REST for short audio; tests use a
// fake). The audio only passes through memory on its way to Azure: nothing here stores it.
import type { LearnLang } from "../../shared/enums";
import { PRON_SAMPLE_RATE } from "../../shared/wav";
import { azureSpeechConfig, SPEECH_LOCALES, type AzureEnv } from "./azureSpeech";

const TIMEOUT_MS = 20_000;

/** `status` is Azure's HTTP status, or null when no response arrived (network, timeout). */
export class PronError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

export type PronOptions = {
  /** Mark words as omitted / inserted against the reference text (sentences, not single words). */
  miscue?: boolean;
  /** Ask for named phonemes; Azure documents names for `en-US` only. */
  alphabet?: "IPA" | "SAPI";
  /** Stress / intonation / rhythm score. Azure documents it for `en-US` only. */
  prosody?: boolean;
};

export interface PronClient {
  /** Scores `wav` (16 kHz mono PCM) against `referenceText`; resolves with Azure's parsed JSON. */
  assess(wav: ArrayBuffer, lang: LearnLang, referenceText: string, options?: PronOptions): Promise<unknown>;
}

/**
 * The `Pronunciation-Assessment` header: Base64 of a UTF-8 JSON object. `btoa` alone only takes
 * Latin-1, and every Korean reference text is outside it, so the bytes are encoded first.
 */
export function buildPronHeader(referenceText: string, options: PronOptions = {}): string {
  const params: Record<string, string> = {
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableMiscue: options.miscue ? "True" : "False",
  };
  if (options.alphabet) params.PhonemeAlphabet = options.alphabet;
  if (options.prosody) params.EnableProsodyAssessment = "True";
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(params))) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const pronEndpoint = (region: string, lang: LearnLang) =>
  `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
  `?language=${SPEECH_LOCALES[lang]}&format=detailed`;

/** Every header of a scoring request: the client below and `npm run pron-probe` send the same ones. */
export const pronRequestHeaders = (key: string, referenceText: string, options?: PronOptions): Record<string, string> => ({
  "Ocp-Apim-Subscription-Key": key,
  "Content-Type": `audio/wav; codecs=audio/pcm; samplerate=${PRON_SAMPLE_RATE}`,
  Accept: "application/json",
  "Pronunciation-Assessment": buildPronHeader(referenceText, options),
});

/** Azure client from env, or null when the key/region are not configured. Tests inject `fetch`. */
export function createPronClient(env: AzureEnv, opts: { fetch?: typeof fetch } = {}): PronClient | null {
  const config = azureSpeechConfig(env);
  if (!config) return null;
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));

  return {
    async assess(wav, lang, referenceText, options) {
      let res: Response;
      try {
        res = await doFetch(pronEndpoint(config.region, lang), {
          method: "POST",
          headers: pronRequestHeaders(config.key, referenceText, options),
          body: wav,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new PronError(`Azure pronunciation request failed: ${String(e)}`);
      }
      // Never include request headers (they carry the key) in errors.
      const text = await res.text().catch(() => "");
      if (!res.ok) throw new PronError(`Azure pronunciation HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new PronError(`Azure pronunciation returned non-JSON: ${text.slice(0, 200)}`, res.status);
      }
    },
  };
}
