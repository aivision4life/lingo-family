// One TOPIK card row → the plain FSRS fields `shared/scheduling.ts` works with. Shared by the
// practice session and the mock test, which both grade with `applyReview`.
import type { CardFields } from "../../shared/scheduling";
import type { topik_cards } from "../../db/schema";

export const toCardFields = (r: typeof topik_cards.$inferSelect): CardFields => ({
  due: r.due,
  stability: r.stability,
  difficulty: r.difficulty,
  elapsed_days: r.elapsed_days,
  scheduled_days: r.scheduled_days,
  learning_steps: r.learning_steps,
  reps: r.reps,
  lapses: r.lapses,
  state: r.state,
  last_review: r.last_review,
});
