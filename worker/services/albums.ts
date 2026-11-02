// Albums = `decks` rows with kind 'album'; membership = `deck_words` (M2.4). The default decks
// (`default-ko`, `default-en`) are never listed, renamed or deleted here.
import { and, eq, inArray, sql } from "drizzle-orm";
import { normalizeTerm } from "../../shared/base";
import type { Album, AlbumCover, AlbumRef } from "../../shared/album";
import type { ImageStatus, LearnLang } from "../../shared/enums";
import { deck_words, decks, words } from "../../db/schema";
import type { getDb } from "../env";
import { readInD1Chunks } from "../lib/d1Chunk";

type Db = ReturnType<typeof getDb>;

export type CoverCandidate = { image_key: string | null; image_status: ImageStatus; emoji: string | null };

/**
 * `members` are the album's words in the order they were added. The cover is the first word with a
 * ready image; without one, the first word with an emoji; otherwise none.
 */
export function pickCover(members: CoverCandidate[]): AlbumCover {
  const withImage = members.find((m) => m.image_status === "ready" && m.image_key);
  if (withImage) return { image_key: withImage.image_key, image_status: "ready", emoji: withImage.emoji };
  const withEmoji = members.find((m) => m.emoji);
  return withEmoji ? { image_key: null, image_status: withEmoji.image_status, emoji: withEmoji.emoji } : null;
}

export async function listAlbums(db: Db, lang?: LearnLang): Promise<Album[]> {
  const albums = await db
    .select({ id: decks.id, name: decks.name, lang: decks.lang })
    .from(decks)
    .where(and(eq(decks.kind, "album"), lang ? eq(decks.lang, lang) : undefined))
    .orderBy(sql`${decks.name} COLLATE NOCASE`);
  if (albums.length === 0) return [];

  // Oldest membership first, so the cover stays stable while words are added later. Chunked
  // because the number of albums a family makes has no upper bound and each one binds a parameter
  // (D1 refuses a statement over 100). Every row of one album lands in the same chunk — a row has
  // exactly one `deck_id` — so each album's own ordering survives the split, and the grouping into
  // `byAlbum` below is what the cover is picked from anyway.
  const members = await readInD1Chunks(
    albums.map((a) => a.id),
    (chunk) =>
      db
        .select({
          deck_id: deck_words.deck_id,
          image_key: words.image_key,
          image_status: words.image_status,
          emoji: words.emoji,
        })
        .from(deck_words)
        .innerJoin(words, eq(words.id, deck_words.word_id))
        .where(inArray(deck_words.deck_id, chunk))
        .orderBy(deck_words.deck_id, deck_words.added_at, sql`${deck_words}.rowid`),
  );
  const byAlbum = new Map<string, CoverCandidate[]>();
  for (const m of members) byAlbum.set(m.deck_id, [...(byAlbum.get(m.deck_id) ?? []), m]);

  return albums.map((a) => {
    const list = byAlbum.get(a.id) ?? [];
    return { ...a, word_count: list.length, cover: pickCover(list) };
  });
}

/** Words that belong to no album, per language (the virtual "Unsorted" entry). */
export async function unsortedCounts(db: Db) {
  const rows = await db
    .select({ lang: words.lang, n: sql<number>`count(*)` })
    .from(words)
    .where(
      sql`NOT EXISTS (SELECT 1 FROM deck_words dw JOIN decks d ON d.id = dw.deck_id WHERE dw.word_id = ${words.id} AND d.kind = 'album')`,
    )
    .groupBy(words.lang);
  return (["ko", "en"] as const).map((lang) => ({ lang, word_count: rows.find((r) => r.lang === lang)?.n ?? 0 }));
}

export const loadAlbum = (db: Db, id: string) =>
  db.select().from(decks).where(and(eq(decks.id, id), eq(decks.kind, "album"))).get();

/** An existing album of the same language with the same name (case-insensitive, normalized). */
export async function findAlbumByName(db: Db, lang: LearnLang, name: string, exceptId?: string) {
  const key = normalizeTerm(name).toLowerCase();
  const rows = await db.select({ id: decks.id, name: decks.name }).from(decks).where(and(eq(decks.kind, "album"), eq(decks.lang, lang)));
  return rows.find((r) => r.id !== exceptId && normalizeTerm(r.name).toLowerCase() === key);
}

/** Albums of a word, by name. */
export async function albumsOfWord(db: Db, wordId: string): Promise<AlbumRef[]> {
  return db
    .select({ id: decks.id, name: decks.name })
    .from(deck_words)
    .innerJoin(decks, eq(decks.id, deck_words.deck_id))
    .where(and(eq(deck_words.word_id, wordId), eq(decks.kind, "album")))
    .orderBy(sql`${decks.name} COLLATE NOCASE`);
}

/** Ids of the words in an album. */
export async function albumWordIds(db: Db, albumId: string): Promise<Set<string>> {
  const rows = await db.select({ id: deck_words.word_id }).from(deck_words).where(eq(deck_words.deck_id, albumId));
  return new Set(rows.map((r) => r.id));
}

/** INSERT OR IGNORE statements adding words to albums (re-adding is harmless). */
export const addWordsStatements = (d1: D1Database, albumId: string, wordIds: string[], now = Date.now()) =>
  wordIds.map((wordId) =>
    d1.prepare("INSERT OR IGNORE INTO deck_words (deck_id, word_id, added_at) VALUES (?, ?, ?)").bind(albumId, wordId, now),
  );

/** Albums of a language with their word ids (empty albums are left out: nothing to review). */
export async function albumScopes(db: Db, lang: LearnLang) {
  const rows = await db
    .select({ id: decks.id, name: decks.name, word_id: deck_words.word_id })
    .from(decks)
    .innerJoin(deck_words, eq(deck_words.deck_id, decks.id))
    .where(and(eq(decks.kind, "album"), eq(decks.lang, lang)))
    .orderBy(sql`${decks.name} COLLATE NOCASE`);
  const scopes = new Map<string, { id: string; name: string; wordIds: Set<string> }>();
  for (const r of rows) {
    const scope = scopes.get(r.id) ?? { id: r.id, name: r.name, wordIds: new Set<string>() };
    scope.wordIds.add(r.word_id);
    scopes.set(r.id, scope);
  }
  return [...scopes.values()];
}
