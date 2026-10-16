// Prompt for M6.3's answer explanation: one call per TOPIK question, using its full text
// (instruction + stem + all 4 options, since explaining "why" needs every option's wording) plus
// the correct option and the question's own M6.2 vocabulary (so key_terms can only cite it). When
// the stem or an option is an image, the actual image bytes are attached (see
// worker/services/topikExplain.ts#resolveExplainImages) instead of asking the model to guess.
import type { TopikContent, TopikOptions, TopikVocabEntry } from "../../shared/topik";

/** Bump when the prompt or output schema changes, so old cache entries are not reused. */
// v2: (a) requires naming the exact grammar pattern (e.g. "-느라고"), not a vague "this structure" —
// a learner needs the name to look it up again later. (b) An image stem/option used to get a
// placeholder ("no text") with nothing else, so the model could only guess the content from the
// correct answer itself (circular, sometimes wrong) — it now gets the real image attached and is
// told to read it, never to guess.
// v3: v2 named the pattern with the verb stem still attached ("-구하느라고" instead of "-느라고"),
// which isn't how a grammar reference/dictionary lists it — the learner can't look that up. Now
// explicitly told to strip the stem and keep only the ending itself.
export const TOPIK_EXPLAIN_PROMPT_VERSION = "topik-explain-v3";

const ROLE = "You are a patient Korean-as-a-foreign-language teacher explaining a TOPIK II reading-test answer to a Vietnamese learner, in Vietnamese.";

const contentLabel = (c: TopikContent) => c.text ?? "(xem hình ảnh đính kèm bên dưới)";

export type ExplainInput = {
  instruction: string | null;
  stem: TopikContent;
  options: TopikOptions;
  correct_option: number;
  vocab: TopikVocabEntry[];
};

export function buildTopikExplainPrompt(input: ExplainInput) {
  const hasImages = input.stem.image_key !== null || input.options.some((o) => o.image_key !== null);
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
    "Nếu câu hỏi kiểm tra một điểm ngữ pháp (các lựa chọn là các đuôi/mẫu câu khác nhau của cùng một động từ/tính từ), BẮT BUỘC nêu đích danh mẫu ngữ pháp đó dưới dạng được tra cứu trong từ điển ngữ pháp: CHỈ phần đuôi/mẫu thuần, kèm dấu gạch ngang ở đầu, KHÔNG được dính kèm gốc động từ/tính từ của câu (ví dụ đúng: \"-느라고\", \"-더니\", \"-(으)려면\"; ví dụ SAI vì còn dính gốc động từ: \"-구하느라고\", \"-찾더니\") — không được viết chung chung kiểu \"cấu trúc này\"/\"mẫu câu này\" mà không kèm tên cụ thể, vì người học cần tên đúng chuẩn để tự tra lại trong từ điển ngữ pháp.",
    "explanation_vi chủ yếu là tiếng Việt; được phép nêu đích danh một mẫu ngữ pháp hoặc trích một từ bằng tiếng Hàn (Hangul) MIỄN LÀ đó là một phần của từ/mẫu đã có trong danh sách từ bên dưới — không được viết cả câu hay cụm từ tiếng Hàn tự do, và không được chèn chữ Hán.",
    "key_terms: chọn 3-5 mục THEN CHỐT nhất để làm đúng câu này, và BẮT BUỘC mỗi mục phải là một lemma COPY NGUYÊN VĂN từ danh sách từ đã cho ở trên — không được tạo lemma mới, không được sửa chính tả. Nếu câu kiểm tra ngữ pháp, ưu tiên chọn đúng mục ngữ pháp đó trước.",
    "Nếu danh sách từ đã cho rỗng hoặc không có mục nào thực sự cần thiết, key_terms có thể là mảng rỗng.",
    ...(hasImages
      ? [
          "Đề bài hoặc một/nhiều lựa chọn là hình ảnh (biểu đồ, bảng số liệu, thông báo, ...) — hình ảnh thật đã được đính kèm ngay sau phần văn bản này, mỗi hình có một dòng nhãn ngay phía trước (ví dụ \"Hình ảnh đề bài:\"). PHẢI đọc kỹ nội dung thật trong hình (số liệu, chữ trong ảnh, ...) rồi mới giải thích — TUYỆT ĐỐI không suy đoán ngược nội dung từ đáp án đúng rồi viết như thể đó là sự thật trong ảnh.",
        ]
      : []),
  ].join("\n");

  return { system, user };
}
