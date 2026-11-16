import type { LearnLang } from "../../shared/enums";
import { AZURE_KO_WORD } from "../../shared/pronScore.fixtures";
import type { PronClient, PronOptions } from "../services/pronunciation";

/**
 * Fake pronunciation scorer: records calls, returns a canned answer, can fail. The default answer
 * is a real `ko-KR` body captured from Azure (M3.0), so a route test is normalized the same way a
 * production answer is.
 */
export function fakePron() {
  const calls: { bytes: number; lang: LearnLang; text: string; options: PronOptions | undefined }[] = [];
  const state: { fail: boolean; answer: unknown } = { fail: false, answer: AZURE_KO_WORD };
  const client: PronClient = {
    async assess(wav, lang, text, options) {
      calls.push({ bytes: wav.byteLength, lang, text, options });
      if (state.fail) throw new Error("fake pronunciation failure");
      return state.answer;
    },
  };
  return { client, calls, state };
}
