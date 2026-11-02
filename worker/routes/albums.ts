// /api/albums and /api/words/:id/albums (M2.4). Reading is open to every profile; creating,
// renaming, deleting and changing membership is for adult profiles only (requireAdult).
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  ALBUM_ERRORS,
  albumCreateSchema,
  albumDeleteSchema,
  albumListQuerySchema,
  albumRenameSchema,
  albumWordsSchema,
  wordAlbumsSchema,
  type AlbumList,
} from "../../shared/album";
import { deck_words, decks, words } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";
import { zv } from "../lib/validate";
import { addWordsStatements, albumsOfWord, findAlbumByName, listAlbums, loadAlbum, unsortedCounts } from "../services/albums";
import { readInD1Chunks } from "../lib/d1Chunk";

const idParam = zv("param", z.object({ id: z.string().min(1) }));
const notFound = { error: ALBUM_ERRORS.notFound } as const;

export const albumRoutes = new Hono<AppEnv>()
  .get("/albums", zv("query", albumListQuerySchema), async (c) => {
    const db = getDb(c.env);
    const { lang } = c.req.valid("query");
    const body: AlbumList = { albums: await listAlbums(db, lang), unsorted: await unsortedCounts(db) };
    return c.json(body);
  })

  .post("/albums", zv("json", albumCreateSchema), async (c) => {
    const db = getDb(c.env);
    const { profile_id, name, lang } = c.req.valid("json");
    const denied = await requireAdult(c, profile_id);
    if (denied) return denied;
    const dup = await findAlbumByName(db, lang, name);
    if (dup) return c.json({ error: ALBUM_ERRORS.duplicate, existing_id: dup.id }, 409);
    const id = crypto.randomUUID();
    await db.insert(decks).values({ id, name, lang, kind: "album" });
    return c.json({ id }, 201);
  })

  .patch("/albums/:id", idParam, zv("json", albumRenameSchema), async (c) => {
    const db = getDb(c.env);
    const { id } = c.req.valid("param");
    const { profile_id, name } = c.req.valid("json");
    const denied = await requireAdult(c, profile_id);
    if (denied) return denied;
    const album = await loadAlbum(db, id);
    if (!album) return c.json(notFound, 404);
    const dup = await findAlbumByName(db, album.lang, name, id);
    if (dup) return c.json({ error: ALBUM_ERRORS.duplicate, existing_id: dup.id }, 409);
    await db.update(decks).set({ name }).where(eq(decks.id, id));
    return c.json({ id });
  })

  /** Deletes the album and its links only; the words stay in the library. */
  .delete("/albums/:id", idParam, zv("json", albumDeleteSchema), async (c) => {
    const { id } = c.req.valid("param");
    const denied = await requireAdult(c, c.req.valid("json").profile_id);
    if (denied) return denied;
    const deleted = await getDb(c.env).delete(decks).where(and(eq(decks.id, id), eq(decks.kind, "album"))).returning({ id: decks.id });
    return deleted.length === 0 ? c.json(notFound, 404) : c.body(null, 204);
  })

  .post("/albums/:id/words", idParam, zv("json", albumWordsSchema), async (c) => {
    const db = getDb(c.env);
    const { id } = c.req.valid("param");
    const { profile_id, word_ids } = c.req.valid("json");
    const denied = await requireAdult(c, profile_id);
    if (denied) return denied;
    const album = await loadAlbum(db, id);
    if (!album) return c.json(notFound, 404);

    const ids = [...new Set(word_ids)];
    // One bound parameter per id, and `ALBUM_BATCH_MAX` is 200 — twice D1's ceiling for a single
    // statement, so selecting them all at once failed outright for a large selection.
    const found = await readInD1Chunks(ids, (chunk) =>
      db.select({ id: words.id, lang: words.lang }).from(words).where(inArray(words.id, chunk)),
    );
    if (found.length !== ids.length) return c.json({ error: "not_found" }, 404);
    if (found.some((w) => w.lang !== album.lang)) return c.json({ error: ALBUM_ERRORS.languageMismatch }, 400);

    const before = await db.select({ id: deck_words.word_id }).from(deck_words).where(eq(deck_words.deck_id, id));
    await c.env.DB.batch(addWordsStatements(c.env.DB, id, ids));
    const known = new Set(before.map((r) => r.id));
    return c.json({ changed: ids.filter((w) => !known.has(w)).length });
  })

  .delete("/albums/:id/words", idParam, zv("json", albumWordsSchema), async (c) => {
    const db = getDb(c.env);
    const { id } = c.req.valid("param");
    const { profile_id, word_ids } = c.req.valid("json");
    const denied = await requireAdult(c, profile_id);
    if (denied) return denied;
    if (!(await loadAlbum(db, id))) return c.json(notFound, 404);
    const removed = await readInD1Chunks(
      [...new Set(word_ids)],
      (chunk) =>
        db
          .delete(deck_words)
          .where(and(eq(deck_words.deck_id, id), inArray(deck_words.word_id, chunk)))
          .returning({ id: deck_words.word_id }),
      // The deck id is bound alongside the ids in the same statement.
      { reserved: 1 },
    );
    return c.json({ changed: removed.length });
  })

  /** Replaces the set of albums a word belongs to (albums of its own language). */
  .put("/words/:id/albums", idParam, zv("json", wordAlbumsSchema), async (c) => {
    const db = getDb(c.env);
    const { id } = c.req.valid("param");
    const { profile_id, album_ids } = c.req.valid("json");
    const denied = await requireAdult(c, profile_id);
    if (denied) return denied;
    const word = await db.select({ id: words.id, lang: words.lang }).from(words).where(eq(words.id, id)).get();
    if (!word) return c.json({ error: "not_found" }, 404);

    const wanted = [...new Set(album_ids)];
    if (wanted.length > 0) {
      const found = await db.select({ id: decks.id, lang: decks.lang }).from(decks).where(and(eq(decks.kind, "album"), inArray(decks.id, wanted)));
      if (found.length !== wanted.length) return c.json(notFound, 404);
      if (found.some((a) => a.lang !== word.lang)) return c.json({ error: ALBUM_ERRORS.languageMismatch }, 400);
    }
    const current = new Set((await albumsOfWord(db, id)).map((a) => a.id));
    const toAdd = wanted.filter((a) => !current.has(a));
    const toRemove = [...current].filter((a) => !wanted.includes(a));
    const statements = [
      ...toAdd.flatMap((a) => addWordsStatements(c.env.DB, a, [id])),
      ...toRemove.map((a) => c.env.DB.prepare("DELETE FROM deck_words WHERE deck_id = ? AND word_id = ?").bind(a, id)),
    ];
    if (statements.length > 0) await c.env.DB.batch(statements);
    return c.json({ albums: await albumsOfWord(db, id) });
  });
