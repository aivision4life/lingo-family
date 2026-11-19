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
    // Speaking (M3.3): the text to read is on the front with its image — it is the reference the
    // score is measured against, so hiding it would make the exercise impossible, not harder.
    case "speaking":
      return { image: true, term: true, bigSpeaker: false, meaning: back };
    default:
      return { image: back, term: true, bigSpeaker: false, meaning: back };
  }
}

/**
 * Whether audio plays automatically when the card appears. Picture waits for the flip (the sound
 * would spoil the word); speaking never plays by itself, so the microphone does not record the
 * app's own voice — the learner taps the speaker when they want to hear it first.
 */
export const autoPlaysOnFront = (type: CardType) => type !== "picture" && type !== "speaking";
