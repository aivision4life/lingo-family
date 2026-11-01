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
