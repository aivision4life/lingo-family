// Where a word was met in TOPIK, and the album it joins because of it (M7.12).
//
// Its own module, not part of `shared/topik.ts`: `shared/word.ts` needs these, and topik.ts
// already imports `posSchema` from word.ts — putting them there would make the two files import
// each other, and a zod schema read during a circular import is `undefined`.
import { z } from "zod";
import { topikSectionSchema } from "./enums";

/**
 * The album a word joins when it is added from a TOPIK question (M7.12), one per section.
 *
 * A plain constant, deliberately **not** i18n: an album name lives in `decks.name`, which is data
 * shared by the whole family, while the interface language is per profile — a translated name
 * would have a Vietnamese profile and a Korean one create two different albums for the same thing.
 * Albums are family-wide (there is no profile column on `decks`), so there is one of each.
 */
export const TOPIK_ALBUM = { reading: "TOPIK II Reading", listening: "TOPIK II Listening" } as const;

/** Where a word was met, carried from the question into the library (M7.12). */
export const topikWordSourceSchema = z.object({
  section: topikSectionSchema,
  exam: z.string().min(1),
  number: z.number().int().positive(),
});
export type TopikWordSource = z.infer<typeof topikWordSourceSchema>;

/** How many questions are remembered per word. The first few say where it came from; a longer
 * list is a list, not an answer. */
export const TOPIK_SOURCES_MAX = 5;
