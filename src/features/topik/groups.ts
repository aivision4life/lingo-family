// Questions that share one recording (M7.5). The real paper prints them on one page and the tape
// plays once, so they are one screen: answered in either order, left blank in either order, and
// never split across two sessions or two screens.
//
// Pure and tiny on purpose — the rule is "same clip, same screen", and the data already says which
// clip a question belongs to (`group_id`, the segment's id, or the question's own id when it has
// no clip at all, i.e. every reading question).

export type Groupable = { id: string; group_id: string; number: number };

export type QuestionGroup<T extends Groupable> = { group_id: string; questions: T[] };

/** Groups consecutive questions by `group_id`, keeping the order they arrived in. */
export function groupQuestions<T extends Groupable>(questions: readonly T[]): QuestionGroup<T>[] {
  const groups: QuestionGroup<T>[] = [];
  for (const question of questions) {
    const last = groups[groups.length - 1];
    if (last && last.group_id === question.group_id) last.questions.push(question);
    else groups.push({ group_id: question.group_id, questions: [question] });
  }
  return groups;
}

/** Which group holds `questionId`, so a jump from the per-question strip lands on its screen. */
export const groupIndexOf = <T extends Groupable>(groups: readonly QuestionGroup<T>[], questionId: string) =>
  groups.findIndex((g) => g.questions.some((q) => q.id === questionId));

/** "Câu 21–22" for a pair, "Câu 7" for a lone question: the exam's own numbers, never positions. */
export function groupNumbers<T extends Groupable>(group: QuestionGroup<T>): { from: number; to: number } {
  const numbers = group.questions.map((q) => q.number);
  return { from: Math.min(...numbers), to: Math.max(...numbers) };
}

/** How many questions came before this group — the progress bar counts questions, not screens. */
export const questionsBefore = <T extends Groupable>(groups: readonly QuestionGroup<T>[], index: number) =>
  groups.slice(0, index).reduce((n, g) => n + g.questions.length, 0);
