// Prompt for M6.3's answer explanation: one call per TOPIK question, using its full text
// (instruction + stem + all 4 options, since explaining "why" needs every option's wording) plus
// the correct option and the question's own M6.2 vocabulary (so key_terms can only cite it).
import type { TopikContent, TopikOptions, TopikVocabEntry } from "../../shared/topik";

/** Bump when the prompt or output schema changes, so old cache entries are not reused. */
export const TOPIK_EXPLAIN_PROMPT_VERSION = "topik-explain-v1";

const ROLE = "You are a patient Korean-as-a-foreign-language teacher explaining a TOPIK II reading-test answer to a Vietnamese learner, in Vietnamese.";

const contentLabel = (c: TopikContent) => c.text ?? "(hình ảnh — không có chữ)";

export type ExplainInput = {
  instruction: string | null;
  stem: TopikContent;
  options: TopikOptions;
  correct_option: number;
  vocab: TopikVocabEntry[];
};

export function buildTopikExplainPrompt(input: ExplainInput) {
  const optionLines = input.options.map((o, i) => `${i + 1}) ${contentLabel(o)}${i + 1 === input.correct_option ? "  [đáp án đúng]" : ""}`);
  const vocabLines = input.vocab.map((v) => `- ${v.lemma} (${v.pos}): ${v.gloss_vi}`);

  const user = [
    input.instruction ? `Hướng dẫn: ${input.instruction}` : null,
    `Đề bài: ${contentLabel(input.stem)}`,
    "Các lựa chọn:",
    ...optionLines,
    vocabLines.length > 0 ? "Danh sách từ/mẫu ngữ pháp đã biết của câu này (CHỈ được chọn key_terms từ đây, viết đúng y nguyên lemma):" : null,
    ...vocabLines,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const system = [
    ROLE,
    'Answer with a single JSON object {"explanation_vi": "...", "key_terms": [...]} that matches the given schema. No markdown, no comments.',
    "explanation_vi: viết bằng tiếng Việt, ngắn gọn (3-6 câu). Giải thích vì sao đáp án đúng là đúng, VÀ vì sao từng đáp án sai lại sai (ngắn gọn, không cần dài dòng từng lựa chọn một nếu lý do giống nhau).",
    "Nếu câu hỏi kiểm tra một điểm ngữ pháp (các lựa chọn là các đuôi/mẫu câu khác nhau của cùng một động từ/tính từ), PHẢI nêu rõ tên hoặc ý nghĩa của điểm ngữ pháp đó — lỗi sai ở dạng câu này thường do chưa nắm ngữ pháp, không chỉ do thiếu từ vựng.",
    "explanation_vi chỉ dùng tiếng Việt: không chèn chữ Hàn hay chữ Hán (nếu cần nhắc tới một từ/mẫu tiếng Hàn, phiên âm hoặc dịch nghĩa thay vì viết nguyên văn Hangul).",
    "key_terms: chọn 3-5 mục THEN CHỐT nhất để làm đúng câu này, và BẮT BUỘC mỗi mục phải là một lemma COPY NGUYÊN VĂN từ danh sách từ đã cho ở trên — không được tạo lemma mới, không được sửa chính tả. Nếu câu kiểm tra ngữ pháp, ưu tiên chọn đúng mục ngữ pháp đó trước.",
    "Nếu danh sách từ đã cho rỗng hoặc không có mục nào thực sự cần thiết, key_terms có thể là mảng rỗng.",
  ].join("\n");

  return { system, user };
}
