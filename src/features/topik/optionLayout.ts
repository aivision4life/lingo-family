// Which layout a question's four options need (M7.2). Pure, so the rule is unit tested.
import type { TopikContent } from "@shared/topik";

/**
 * Whether every option is a picture and nothing else.
 *
 * TOPIK II listening questions 1-3 ask which of four drawings matches what was said, and those
 * drawings carry the whole question: who is holding what, which way a person is facing, what is on
 * the table. Shown as a 64px thumbnail in a text row they are unreadable, so a question like that
 * needs a layout of its own — big pictures, numbered on the image. A mixed question (text options,
 * or one option that happens to have a picture beside its text) keeps the ordinary text rows: there
 * the picture is an illustration, not the thing being asked about.
 */
export function allPictureOptions(options: readonly TopikContent[]): boolean {
  return options.length > 0 && options.every((o) => o.image_key !== null && (o.text === null || o.text.trim() === ""));
}

/**
 * How one picture option looks right now (M6.4 fix).
 *
 * "chosen" exists only during a mock test: an answer is picked but nothing has been graded yet.
 * Practice never has that state — it grades the moment you choose — which is why a picture option
 * that showed no sign at all of being chosen went unnoticed until a real sitting on a phone, where
 * tapping "Chọn 2" looked like the app had simply ignored the tap.
 */
export type PictureOptionState = "correct" | "wrong" | "dimmed" | "chosen" | "idle";

export function pictureOptionState(args: { option: number; selected: number | null; correct: number | null; answered: boolean }): PictureOptionState {
  const { option, selected, correct, answered } = args;
  if (answered) {
    if (correct === option) return "correct";
    if (selected === option) return "wrong";
    return "dimmed";
  }
  return selected === option ? "chosen" : "idle";
}
