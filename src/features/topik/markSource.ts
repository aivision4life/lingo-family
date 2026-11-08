// Which question the screen is showing, for the terms marked on it (M7.12).
//
// A marked term has to remember where it was met: the section picks the album it joins ("TOPIK II
// Reading" / "TOPIK II Listening"), and the exam label plus the question number are kept with the
// word so it can be traced back later. The tap targets that offer the mark sit deep inside the
// question card — a word popover inside the stem's text, the key-terms list under the explanation
// — so a context is what spares every text renderer in between a prop it has no use for.
import { createContext, useContext } from "react";
import type { TopikWordSource } from "@shared/topik";

export const MarkSourceContext = createContext<TopikWordSource | null>(null);

/**
 * The question a mark would come from, or null where the screen cannot say which question it is.
 *
 * This used to throw, on the reasoning that a term marked without its question could not be filed
 * in an album and failing loudly beat dropping it silently. The reasoning was right and the place
 * was wrong: it threw during **render**, so a screen that merely *could* offer a mark it cannot
 * attribute died completely — the listening transcript took down the whole practice screen the
 * moment a word in it was tapped (M7.22).
 *
 * The invariant survives without the throw, structurally: `TopikMarkToggle` renders nothing when
 * this is null, so there is no button, so nothing can be marked without a source. The failure mode
 * is now a missing button on a working screen.
 */
export function useMarkSource(): TopikWordSource | null {
  return useContext(MarkSourceContext);
}
