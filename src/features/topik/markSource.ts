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
 * The question a mark would come from. Throws when there is none: a term marked without its
 * question could not be filed in an album, and failing here is better than silently dropping it.
 */
export function useMarkSource(): TopikWordSource {
  const source = useContext(MarkSourceContext);
  if (!source) throw new Error("useMarkSource must be used inside a MarkSourceContext provider");
  return source;
}
