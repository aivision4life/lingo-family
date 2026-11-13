// Azure Speech configuration shared by text-to-speech (tts.ts) and pronunciation scoring
// (pronunciation.ts). Neither of those depends on the other; both depend on this.
import type { LearnLang } from "../../shared/enums";

export type AzureEnv = { AZURE_SPEECH_KEY?: string; AZURE_SPEECH_REGION?: string };

/** Azure locale of each study language (synthesis and recognition use the same codes). */
export const SPEECH_LOCALES: Record<LearnLang, string> = { ko: "ko-KR", en: "en-US" };

/**
 * Key + region, or null when Azure Speech is not configured.
 *
 * Both values are trimmed: a secret pasted with Ctrl+V in `cmd` once arrived with a stray control
 * character (CLAUDE.md, "Secrets & security"), and a key with a trailing newline is answered with
 * the same 401 as a wrong key. Trimming cannot repair a wrong value, only a padded one. The region
 * becomes part of a host name, so anything that is not a plain region id is "not configured".
 */
export function azureSpeechConfig(env: AzureEnv): { key: string; region: string } | null {
  const key = env.AZURE_SPEECH_KEY?.trim();
  const region = env.AZURE_SPEECH_REGION?.trim();
  if (!key || !region || !/^[a-z0-9]+$/.test(region)) return null;
  return { key, region };
}
