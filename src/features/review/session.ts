// Review session state (pure, unit tested). The server schedules; the session only decides
// what to show next and re-queues cards that are due again within the session.
import { cardFieldsFromDto, type CardDto, type QueueItem } from "@shared/review";
import { repeatsInSession } from "@shared/scheduling";

export type Session = {
  queue: QueueItem[];
  /** Index of the current card in `queue`. */
  pos: number;
  flipped: boolean;
  /** Number of answers given in this session. */
  answered: number;
};

export const startSession = (items: QueueItem[]): Session => ({ queue: items, pos: 0, flipped: false, answered: 0 });

export const currentItem = (s: Session): QueueItem | null => s.queue[s.pos] ?? null;

export const isFinished = (s: Session) => s.pos >= s.queue.length;

export const flip = (s: Session): Session => (isFinished(s) ? s : { ...s, flipped: true });

/**
 * Moves past a card that was **not** reviewed (M3.3): a speaking card with no take the server
 * could score, or one skipped while offline. Nothing was answered, so it is not counted and not
 * put back in the queue — its schedule is exactly what it was.
 */
export const skipCard = (s: Session): Session => (isFinished(s) ? s : { ...s, pos: s.pos + 1, flipped: false });

/** Moves on after the server returned the updated card; learning cards come back at the end. */
export function afterAnswer(s: Session, updated: CardDto, now: Date): Session {
  const item = currentItem(s);
  if (!item) return s;
  const again = repeatsInSession(cardFieldsFromDto(updated), now);
  return {
    queue: again ? [...s.queue, { ...item, card: updated }] : s.queue,
    pos: s.pos + 1,
    flipped: false,
    answered: s.answered + 1,
  };
}
