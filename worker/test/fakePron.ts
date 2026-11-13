import type { LearnLang } from "../../shared/enums";
import type { PronClient, PronOptions } from "../services/pronunciation";

/** Fake pronunciation scorer: records calls, returns a canned Azure-shaped answer, can fail. */
export function fakePron() {
  const calls: { bytes: number; lang: LearnLang; text: string; options: PronOptions | undefined }[] = [];
  const state: { fail: boolean; answer: unknown } = {
    fail: false,
    answer: { RecognitionStatus: "Success", NBest: [{ PronScore: 90, AccuracyScore: 91, FluencyScore: 92, CompletenessScore: 100 }] },
  };
  const client: PronClient = {
    async assess(wav, lang, text, options) {
      calls.push({ bytes: wav.byteLength, lang, text, options });
      if (state.fail) throw new Error("fake pronunciation failure");
      return state.answer;
    },
  };
  return { client, calls, state };
}
