// Albums (M2.4): family playlists of words. API contract shared by the Worker and the app.
// An album is a `decks` row with kind = 'album'; membership is `deck_words` (many-to-many).
import { z } from "zod";
import { normalizeTerm } from "./base";
import { imageStatusSchema, learnLangSchema } from "./enums";

export const ALBUM_NAME_MAX = 60;
/** Words moved in one request (select-many in the Library). */
export const ALBUM_BATCH_MAX = 200;

export const albumNameSchema = z.string().transform(normalizeTerm).pipe(z.string().min(1).max(ALBUM_NAME_MAX));

/** Cover: the image of the first-added word that has one, else the emoji of the first word with one. */
export const albumCoverSchema = z
  .object({ image_key: z.string().nullable(), image_status: imageStatusSchema, emoji: z.string().nullable() })
  .nullable();
export type AlbumCover = z.infer<typeof albumCoverSchema>;

export const albumSchema = z.object({
  id: z.string(),
  name: z.string(),
  lang: learnLangSchema,
  word_count: z.number().int().nonnegative(),
  cover: albumCoverSchema,
});
export type Album = z.infer<typeof albumSchema>;

/** The virtual "Unsorted" entry: words that belong to no album (not stored anywhere). */
export const UNSORTED_ALBUM = "none";

export const albumListSchema = z.object({
  albums: z.array(albumSchema),
  /** Words without any album, per language (for the virtual "Unsorted" entry). */
  unsorted: z.array(z.object({ lang: learnLangSchema, word_count: z.number().int().nonnegative() })),
});
export type AlbumList = z.infer<typeof albumListSchema>;

export const albumListQuerySchema = z.object({ lang: learnLangSchema.optional() });

const profileId = z.string().min(1);
export const albumCreateSchema = z.object({ profile_id: profileId, name: albumNameSchema, lang: learnLangSchema });
export const albumRenameSchema = z.object({ profile_id: profileId, name: albumNameSchema });
export const albumDeleteSchema = z.object({ profile_id: profileId });
/** POST / DELETE /api/albums/:id/words */
export const albumWordsSchema = z.object({
  profile_id: profileId,
  word_ids: z.array(z.string().min(1)).min(1).max(ALBUM_BATCH_MAX),
});
/** PUT /api/words/:id/albums — the complete set of albums (of the word's language) the word belongs to. */
export const wordAlbumsSchema = z.object({ profile_id: profileId, album_ids: z.array(z.string().min(1)).max(50) });

export const albumRefSchema = z.object({ id: z.string(), name: z.string() });
export type AlbumRef = z.infer<typeof albumRefSchema>;
export const wordAlbumsResponseSchema = z.object({ albums: z.array(albumRefSchema) });
export const albumCreatedSchema = z.object({ id: z.string() });
export const albumChangedSchema = z.object({ changed: z.number().int().nonnegative() });

export const ALBUM_ERRORS = {
  /** An album with this name already exists in this language; body has `existing_id`. */
  duplicate: "duplicate_album",
  /** A word and an album must have the same language. */
  languageMismatch: "album_language_mismatch",
  notFound: "album_not_found",
} as const;
