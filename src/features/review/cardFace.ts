// What each side of each card type shows (SPEC F4 table, M1.9). Pure, unit tested.
import type { CardType } from "@shared/enums";

export type CardFace = {
  /** Large image (kept off recognition's front: it would give the meaning away). */
  image: boolean;
  /** The word / phrase with its audio button. */
  term: boolean;
  /** Only a big "play again" speaker (listening front). */
  bigSpeaker: boolean;
  /** Reading, root word, meaning, Hanja / Hán-Việt and the example sentences (always the back). */
  meaning: boolean;
};

export function cardFace(type: CardType, flipped: boolean): CardFace {
  const back = flipped;
  switch (type) {
    case "picture":
      return { image: true, term: back, bigSpeaker: false, meaning: back };
    case "listening":
      return { image: back, term: back, bigSpeaker: !back, meaning: back };
    default:
      return { image: back, term: true, bigSpeaker: false, meaning: back };
  }
}

/** Whether audio plays automatically when the card appears (picture waits for the flip: it would spoil the word). */
export const autoPlaysOnFront = (type: CardType) => type !== "picture";
