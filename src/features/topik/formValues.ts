import { DEFAULT_QUESTION_POINTS, pointsFromInstruction, type TopikContent, type TopikQuestion, type TopikQuestionInput } from "@shared/topik";

export type TopikFormValues = {
  exam: string;
  number: string;
  block: string;
  instruction: string;
  /** What the question is worth (M6.4). Kept as text so the field can be cleared while typing. */
  points: string;
  stem: TopikContent;
  options: [TopikContent, TopikContent, TopikContent, TopikContent];
  /** null = not chosen yet — required before saving, so a new question is never saved with the
   * wrong option picked by accident (M6.1 "Lưu và thêm câu tiếp" never defaults to option 1). */
  correct_option: number | null;
};

export const emptyTopikFormValues = (block = ""): TopikFormValues => ({
  exam: "",
  number: "",
  block,
  instruction: "",
  points: String(DEFAULT_QUESTION_POINTS),
  stem: { text: "", image_key: null },
  options: [
    { text: "", image_key: null },
    { text: "", image_key: null },
    { text: "", image_key: null },
    { text: "", image_key: null },
  ],
  correct_option: null,
});

export const topikFormValuesFromQuestion = (q: TopikQuestion): TopikFormValues => ({
  exam: q.exam,
  number: String(q.number),
  block: q.block,
  instruction: q.instruction ?? "",
  points: String(q.points),
  stem: q.stem,
  options: q.options as TopikFormValues["options"],
  correct_option: q.correct_option,
});

export function toTopikInput(v: TopikFormValues): TopikQuestionInput | null {
  const number = Number(v.number);
  if (!v.exam.trim() || !v.block.trim() || !Number.isInteger(number) || number <= 0) return null;
  if (v.options.some((o) => !o.text?.trim() && !o.image_key)) return null;
  if (v.correct_option === null) return null;
  // Typed by hand wins; an empty box falls back to what the instruction says, then to the default.
  const typed = Number(v.points);
  const points = Number.isInteger(typed) && typed > 0 && typed <= 10 ? typed : (pointsFromInstruction(v.instruction) ?? DEFAULT_QUESTION_POINTS);
  return {
    section: "reading",
    exam: v.exam.trim(),
    number,
    block: v.block.trim(),
    instruction: v.instruction.trim() || null,
    stem: { text: v.stem.text?.trim() || null, image_key: v.stem.image_key },
    options: v.options.map((o) => ({ text: o.text?.trim() || null, image_key: o.image_key })) as TopikQuestionInput["options"],
    correct_option: v.correct_option,
    points,
  };
}
