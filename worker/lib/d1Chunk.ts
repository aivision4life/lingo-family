// Keeping a D1 statement under its parameter ceiling (M6.4 fix).
//
// D1 refuses any single statement that binds more than 100 parameters ("too many SQL variables").
// A multi-row INSERT binds one parameter per column *per row*, so the ceiling is reached by data
// growing, not by code changing: a mock test of 12 questions bound 84 and worked, 20 questions
// bound 140 and returned 500 on every attempt. The limit is per statement, so a `db.batch()` of
// many single-row statements is unaffected — only statements whose size follows the row count.
//
// Everything that builds such a statement goes through here rather than each caller remembering
// the number 100.

/** D1's hard limit on bound parameters in one statement. */
export const D1_MAX_PARAMS = 100;

/**
 * Splits rows into chunks small enough that one statement per chunk stays under the ceiling.
 *
 * `reserved` is for parameters the statement binds outside the rows — a `WHERE profile_id = ?`
 * next to an `IN (...)`, say. A row that cannot fit even alone is still emitted on its own: that
 * is a statement D1 will reject, and failing loudly beats silently dropping rows.
 */
export function chunkForD1<T>(rows: readonly T[], paramsPerRow: number, opts: { reserved?: number; limit?: number } = {}): T[][] {
  const limit = opts.limit ?? D1_MAX_PARAMS;
  const budget = limit - (opts.reserved ?? 0);
  const perChunk = Math.max(1, Math.floor(budget / Math.max(1, paramsPerRow)));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += perChunk) chunks.push(rows.slice(i, i + perChunk));
  return chunks;
}

/** Runs `write` once per chunk, in order, so a bulk insert cannot exceed the ceiling. */
export async function writeInD1Chunks<T>(
  rows: readonly T[],
  paramsPerRow: number,
  write: (chunk: T[]) => Promise<unknown>,
  opts?: { reserved?: number },
): Promise<void> {
  for (const chunk of chunkForD1(rows, paramsPerRow, opts)) await write(chunk);
}

/**
 * The same for a read whose `IN (...)` binds one parameter per id, concatenating the results.
 *
 * Order across chunks follows the id order given, which is why callers that need a specific order
 * sort the result themselves rather than relying on the database.
 */
export async function readInD1Chunks<Id, R>(
  ids: readonly Id[],
  read: (chunk: Id[]) => Promise<R[]>,
  opts: { reserved?: number } = {},
): Promise<R[]> {
  if (ids.length === 0) return [];
  const out: R[] = [];
  for (const chunk of chunkForD1(ids, 1, opts)) out.push(...(await read(chunk)));
  return out;
}
