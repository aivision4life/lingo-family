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
  image_prompt: "A smiling student with a backpack walking to school",
  examples: [
    { sentence: "저는 학생이에요.", translation_vi: "Tôi là học sinh.", translation_en: "I am a student.", translation_ko: "x", image_prompt: "A person reading a book at a desk" },
    { sentence: "학생이 많아요.", translation_vi: "Có nhiều học sinh.", translation_en: "There are many students.", translation_ko: "", image_prompt: "A person reading a book at a desk" },
  ],
  phrases: [
    {
      text: "대학생",
      reading: "daehaksaeng",
      gloss_vi: "sinh viên",
      gloss_en: "university student",
      gloss_ko: "대학에 다니는 학생",
      image_prompt: "A young adult carrying books on a university campus",
      example: { sentence: "저는 대학생이에요.", translation_vi: "Tôi là sinh viên.", translation_en: "I am a university student.", translation_ko: "", image_prompt: "A person reading a book at a desk" },
    },
    {
      text: "학생증",
      reading: "haksaengjeung",
      gloss_vi: "thẻ học sinh",
      gloss_en: "student ID card",
      gloss_ko: "학생임을 증명하는 카드",
      image_prompt: "A plastic student ID card with a photo",
      example: { sentence: "학생증을 보여 주세요.", translation_vi: "Cho xem thẻ học sinh.", translation_en: "Please show your student ID.", translation_ko: "", image_prompt: "A person reading a book at a desk" },
    },
  ],
};

/** Fake LLM that returns the given raw texts in order (last one repeats) and records requests. */
export function fakeLlm(outputs: string[] = [JSON.stringify(sampleEnrichment)]) {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    model: "fake-model",
    async generate(req) {
      requests.push(req);
      return { text: outputs[Math.min(requests.length - 1, outputs.length - 1)]!, model: "fake-model" };
    },
  };
  return { client, requests };
}
