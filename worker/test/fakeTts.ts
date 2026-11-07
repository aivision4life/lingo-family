import type { LearnLang } from "../../shared/enums";
import type { TtsClient } from "../services/tts";

/** Fake TTS: returns small fake "mp3" bytes, records calls, can be told to fail. */
export function fakeTts() {
  const calls: { text: string; lang: LearnLang; voice: string }[] = [];
  /** `message` lets a test pick the provider error's shape (M7.13 classifies 401/403 apart). */
  const state = { fail: false, message: "fake TTS failure" };
  const client: TtsClient = {
    async synthesize(text, lang, voice) {
      calls.push({ text, lang, voice });
      if (state.fail) throw new Error(state.message);
      const bytes = new TextEncoder().encode(`mp3:${voice}:${text}`);
      const buffer = new ArrayBuffer(bytes.length);
      new Uint8Array(buffer).set(bytes);
      return buffer;
    },
  };
  return { client, calls, state };
}
