import type { LlmEnrichment } from "../../shared/word";
import type { LlmClient, LlmRequest } from "../services/llm";

export const sampleEnrichment: LlmEnrichment = {
  reading: "haksaeng",
  pos: "noun",
  gloss_vi: "học sinh",
  gloss_en: "student",
  gloss_ko: "배우는 사람",
  hanja: "學生",
  han_viet: "học sinh",
  emoji: "🧑‍🎓",
  examples: [
    { sentence: "저는 학생이에요.", translation_vi: "Tôi là học sinh.", translation_en: "I am a student.", translation_ko: "x" },
    { sentence: "학생이 많아요.", translation_vi: "Có nhiều học sinh.", translation_en: "There are many students.", translation_ko: "" },
  ],
};

/** Fake LLM that returns the given raw texts in order (last one repeats) and records requests. */
export function fakeLlm(outputs: string[] = [JSON.stringify(sampleEnrichment)]) {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    model: "fake-model",
    async generate(req) {
      requests.push(req);
      return outputs[Math.min(requests.length - 1, outputs.length - 1)]!;
    },
  };
  return { client, requests };
}
