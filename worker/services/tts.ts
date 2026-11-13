// Text-to-speech behind a small interface (Azure Speech REST now; tests use a fake).
import { z } from "zod";
import type { LearnLang } from "../../shared/enums";
import { sha1Hex } from "../lib/hash";
import { azureSpeechConfig, SPEECH_LOCALES, type AzureEnv } from "./azureSpeech";

export const DEFAULT_VOICES: Record<LearnLang, string> = {
  ko: "ko-KR-SunHiNeural",
  en: "en-US-JennyNeural",
};

/** mp3, mono, 24 kHz (SPEC F3). */
export const AZURE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const TIMEOUT_MS = 20_000;

export class TtsError extends Error {}

export interface TtsClient {
  /** Returns mp3 bytes for `text` spoken by `voice`. */
  synthesize(text: string, lang: LearnLang, voice: string): Promise<ArrayBuffer>;
}

// Optional `vars` in wrangler.jsonc; parsed instead of typed because they may be absent.
const voiceEnvSchema = z.object({
  TTS_VOICE_KO: z.string().optional(),
  TTS_VOICE_EN: z.string().optional(),
});

/** Voice for a language: `vars` in wrangler.jsonc override the defaults. */
export function voiceFor(env: unknown, lang: LearnLang): string {
  const parsed = voiceEnvSchema.safeParse(env);
  const vars = parsed.success ? parsed.data : {};
  const override = { ko: vars.TTS_VOICE_KO, en: vars.TTS_VOICE_EN }[lang];
  return override?.trim() || DEFAULT_VOICES[lang];
}

/** Text as it is spoken and hashed: Unicode NFC, trimmed. */
export const normalizeSpeechText = (text: string) => text.normalize("NFC").trim();

/** Content-addressed R2 key: the same lang + voice + text always maps to the same file. */
export async function audioKey(lang: LearnLang, voice: string, text: string): Promise<string> {
  return `audio/${lang}/${voice}/${await sha1Hex(normalizeSpeechText(text))}.mp3`;
}

// Voice names can contain ":" (e.g. "DragonHD" voices).
export const AUDIO_KEY_PATTERN = /^audio\/(ko|en)\/[A-Za-z0-9:-]+\/[0-9a-f]{40}\.mp3$/;

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);

export function buildSsml(text: string, lang: LearnLang, voice: string): string {
  const locale = SPEECH_LOCALES[lang];
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${escapeXml(voice)}">${escapeXml(normalizeSpeechText(text))}</voice></speak>`
  );
}

/** Azure client from env, or null when the key/region are not configured. */
export function createTtsClient(env: AzureEnv): TtsClient | null {
  const config = azureSpeechConfig(env);
  if (!config) return null;
  const { key, region } = config;
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  return {
    async synthesize(text, lang, voice) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": AZURE_OUTPUT_FORMAT,
            "User-Agent": "lingo-family",
          },
          body: buildSsml(text, lang, voice),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new TtsError(`Azure TTS request failed: ${String(e)}`);
      }
      if (!res.ok) {
        // Never include request headers (they carry the key) in errors.
        throw new TtsError(`Azure TTS HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      }
      const audio = await res.arrayBuffer();
      if (audio.byteLength === 0) throw new TtsError("Azure TTS returned empty audio");
      return audio;
    },
  };
}
