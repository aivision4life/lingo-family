import type { LearnLang } from "../../shared/enums";
import type { TtsClient } from "../services/tts";

/** Fake TTS: returns small fake "mp3" bytes, records calls, can be told to fail. */
export function fakeTts() {
  const calls: { text: string; lang: LearnLang; voice: string }[] = [];
  const state = { fail: false };
  const client: TtsClient = {
    async synthesize(text, lang, voice) {
      calls.push({ text, lang, voice });
      if (state.fail) throw new Error("fake TTS failure");
      const bytes = new TextEncoder().encode(`mp3:${voice}:${text}`);
      const buffer = new ArrayBuffer(bytes.length);
      new Uint8Array(buffer).set(bytes);
      return buffer;
    },
  };
  return { client, calls, state };
}
