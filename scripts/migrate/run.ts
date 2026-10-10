// Moves local content (words, phrases, examples, Hanja, AI cache, R2 media) to production.
//
//   node benchmarks/run.mjs scripts/migrate/run.ts            dry run (default): prints the plan, writes nothing
//   node benchmarks/run.mjs scripts/migrate/run.ts --apply    backs up production D1, then copies
//   node benchmarks/run.mjs scripts/migrate/run.ts --verify   checks that profiles got cards (read-only)
//
// Needs `npx wrangler login`. Local D1 is read straight from its SQLite file in .wrangler/state
// (read-only; override with --local-db <file>), local R2 through wrangler; production is reached
// through wrangler "remote bindings" (a temporary config, nothing in wrangler.jsonc changes).
// Never moved: profiles, profile_decks, cards, review_logs, usage_daily, pron_attempts.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getPlatformProxy } from "wrangler";
import { countByTable, planContent, type LocalContent, type Plan, type RemoteContent, type Row } from "./plan";

// --- minimal binding types (this file is compiled without the Workers type definitions) -------
type Stmt = { bind(...values: unknown[]): Stmt; all<T = Row>(): Promise<{ results: T[] }>; first<T = Row>(): Promise<T | null> };
type D1Like = { prepare(sql: string): Stmt; batch(statements: Stmt[]): Promise<unknown[]> };
type R2Meta = { contentType?: string; contentLanguage?: string; contentDisposition?: string; contentEncoding?: string; cacheControl?: string };
type R2Object = { key: string; size: number; httpMetadata?: R2Meta; customMetadata?: Record<string, string> };
type R2Like = {
  list(o: { limit?: number; cursor?: string; include?: string[] }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
  get(key: string): Promise<(R2Object & { arrayBuffer(): Promise<ArrayBuffer> }) | null>;
  put(key: string, value: ArrayBuffer, o: { httpMetadata?: R2Meta; customMetadata?: Record<string, string> }): Promise<unknown>;
};
type Bindings = { DB: D1Like; MEDIA: R2Like };

const PROD_DB_ID = "10da2bc0-1ba1-4ae2-80be-df43cd5b1931";
const PROD_DB_NAME = "lingo-family";
const BUCKET = "lingo-family-media";
const TABLES = ["words", "phrases", "examples", "han_chars", "word_chars", "ai_cache"] as const;
const CHUNK = 25;

const args = new Set(process.argv.slice(3));
const apply = args.has("--apply");
const verify = args.has("--verify");

function tempConfig(name: string, config: object) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `lingo-${name}-`));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(file, JSON.stringify({ name: `lingo-migrate-${name}`, compatibility_date: "2026-10-01", ...config }));
  return file;
}

const D1_DIR = path.resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");

/** The local D1 file: --local-db, else the SQLite file with the most words (the hash in its name depends on the database id). */
function findLocalDbFile() {
  const given = process.argv.slice(3).find((_a, i, all) => all[i - 1] === "--local-db");
  if (given) return path.resolve(given);
  const candidates = readdirSync(D1_DIR)
    .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")
    .map((f) => path.join(D1_DIR, f))
    .map((file) => {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        return { file, words: (db.prepare("SELECT count(*) AS n FROM words").get() as { n: number }).n };
      } catch {
        return { file, words: -1 }; // no words table
      } finally {
        db.close();
      }
    })
    .filter((c) => c.words >= 0)
    .sort((x, y) => y.words - x.words);
  if (candidates.length === 0) throw new Error(`No local D1 database with a "words" table in ${D1_DIR}`);
  return candidates[0]!.file;
}

/** Read-only D1-shaped wrapper around a local SQLite file. */
function openLocalD1(file: string): D1Like {
  const db = new DatabaseSync(file, { readOnly: true });
  const stmt = (sql: string): Stmt => {
    const self: Stmt = {
      bind: () => self,
      all: async <T>() => ({ results: db.prepare(sql).all() as T[] }),
      first: async <T>() => (db.prepare(sql).get() as T | undefined) ?? null,
    };
    return self;
  };
  return { prepare: stmt, batch: async () => { throw new Error("local database is read-only"); } };
}

const R2_DIR = path.resolve(".wrangler/state/v3/r2");

/** Read-only R2-shaped wrapper around the local Miniflare bucket (SQLite metadata + blob files). */
function openLocalR2(): R2Like {
  const metaDir = path.join(R2_DIR, "miniflare-R2BucketObject");
  const files = readdirSync(metaDir).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  const best = files
    .map((f) => {
      const db = new DatabaseSync(path.join(metaDir, f), { readOnly: true });
      try {
        return { db, n: (db.prepare("SELECT count(*) AS n FROM _mf_objects").get() as { n: number }).n };
      } catch {
        db.close();
        return null;
      }
    })
    .filter((x): x is { db: DatabaseSync; n: number } => x !== null)
    .sort((x, y) => y.n - x.n)[0];
  if (!best) throw new Error(`No local R2 metadata in ${metaDir}`);
  type ObjectRow = { key: string; blob_id: string | null; size: number; http_metadata: string; custom_metadata: string };
  const toObject = (r: ObjectRow): R2Object => ({
    key: r.key,
    size: r.size,
    httpMetadata: JSON.parse(r.http_metadata) as R2Meta,
    customMetadata: JSON.parse(r.custom_metadata) as Record<string, string>,
  });
  return {
    // The local bucket is small; one page returns everything.
    list: async () => ({ objects: (best.db.prepare("SELECT * FROM _mf_objects ORDER BY key").all() as ObjectRow[]).map(toObject), truncated: false }),
    get: async (key) => {
      const r = best.db.prepare("SELECT * FROM _mf_objects WHERE key = ?").get(key) as ObjectRow | undefined;
      if (!r?.blob_id) return null;
      const buf = readFileSync(path.join(R2_DIR, BUCKET, "blobs", r.blob_id));
      return { ...toObject(r), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
    },
    put: async () => {
      throw new Error("local bucket is read-only");
    },
  };
}

async function openLocal() {
  const file = findLocalDbFile();
  console.log(`Local D1 file: ${path.relative(process.cwd(), file)}`);
  return { env: { DB: openLocalD1(file), MEDIA: openLocalR2() }, dispose: async () => {} };
}

async function openRemote() {
  const configPath = tempConfig("remote", {
    d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: PROD_DB_ID, remote: true }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: BUCKET, remote: true }],
  });
  const proxy = await getPlatformProxy({ configPath, remoteBindings: true });
  return { env: proxy.env as unknown as Bindings, dispose: () => proxy.dispose() };
}

const rows = async <T = Row>(db: D1Like, sql: string) => (await db.prepare(sql).all<T>()).results;
const count = async (db: D1Like, table: string) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;

async function listR2(bucket: R2Like) {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ limit: 1000, cursor, include: ["httpMetadata", "customMetadata"] });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const columnNames = async (db: D1Like, table: string) => (await rows<{ name: string }>(db, `PRAGMA table_info(${table})`)).map((c) => c.name).sort();

async function assertSameSchema(local: D1Like, remote: D1Like) {
  for (const table of TABLES) {
    const [a, b] = [await columnNames(local, table), await columnNames(remote, table)];
    if (a.length === 0) throw new Error(`Local D1 has no table "${table}": is the local database migrated, and is this the right file?`);
    if (a.join() !== b.join()) throw new Error(`Column mismatch in "${table}":\n local: ${a.join(",")}\n prod:  ${b.join(",")}\nApply the same migrations to both first.`);
  }
}

async function loadLocal(db: D1Like): Promise<LocalContent> {
  return {
    words: await rows(db, "SELECT * FROM words ORDER BY created_at, rowid"),
    phrases: await rows(db, "SELECT * FROM phrases ORDER BY created_at, rowid"),
    examples: await rows(db, "SELECT * FROM examples ORDER BY rowid"),
    han_chars: await rows(db, "SELECT * FROM han_chars"),
    word_chars: await rows(db, "SELECT * FROM word_chars"),
    ai_cache: await rows(db, "SELECT * FROM ai_cache ORDER BY created_at"),
  };
}

async function loadRemote(db: D1Like): Promise<RemoteContent> {
  return {
    words: await rows(db, "SELECT id, lang, term FROM words"),
    phrases: await rows(db, "SELECT id, lang, text FROM phrases"),
    exampleIds: (await rows<{ id: string }>(db, "SELECT id FROM examples")).map((r) => r.id),
    hanjas: (await rows<{ hanja: string }>(db, "SELECT hanja FROM han_chars")).map((r) => r.hanja),
    wordCharKeys: (await rows<{ word_id: string; position: number }>(db, "SELECT word_id, position FROM word_chars")).map((r) => `${r.word_id}:${r.position}`),
    aiCacheKeys: (await rows<{ key: string }>(db, "SELECT key FROM ai_cache")).map((r) => r.key),
  } as RemoteContent;
}

const tableCounts = async (db: D1Like) => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await count(db, t)])));

function printCounts(title: string, c: Record<string, number>) {
  console.log(`\n${title}`);
  for (const [t, n] of Object.entries(c)) console.log(`  ${t.padEnd(11)} ${n}`);
}

/** R2 keys referenced by the rows that will be inserted. */
const referencedKeys = (plan: Plan) =>
  new Set(
    [...plan.words, ...plan.phrases, ...plan.examples].flatMap((r) => [r.audio_key, r.image_key]).filter((k): k is string => typeof k === "string" && k !== ""),
  );

function insertStatements(db: D1Like, table: string, data: Row[]) {
  return data.map((row) => {
    const cols = Object.keys(row);
    const sql = `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    return db.prepare(sql).bind(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  });
}

function backupProduction() {
  mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `prod-d1-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
  const r = spawnSync("npx", ["wrangler", "d1", "export", PROD_DB_NAME, "--remote", "--output", file], { stdio: "inherit", shell: true });
  if (r.status !== 0 || !existsSync(file) || statSync(file).size === 0) throw new Error("Production backup failed; nothing was changed.");
  console.log(`\nProduction D1 backed up to ${file} (${statSync(file).size} bytes)`);
}

async function runVerify(remote: D1Like) {
  const profiles = await rows<{ id: string; name: string; is_kid: number; study_langs: string }>(remote, "SELECT id, name, is_kid, study_langs FROM profiles");
  for (const p of profiles) {
    console.log(`\nProfile ${p.name}${p.is_kid ? " (kid)" : ""}`);
    for (const lang of JSON.parse(p.study_langs) as string[]) {
      const one = async (sql: string) => (await remote.prepare(sql).bind(p.id, lang).first<{ n: number }>())?.n ?? 0;
      const words = await count(remote, `words WHERE lang = '${lang}'`);
      const phrases = p.is_kid ? 0 : await count(remote, `phrases WHERE lang = '${lang}'`);
      const cardsOf = (type: string, phrase: boolean) =>
        one(`SELECT count(*) AS n FROM cards c JOIN words w ON w.id = c.word_id WHERE c.profile_id = ?1 AND w.lang = ?2 AND c.card_type = '${type}' AND c.phrase_id IS ${phrase ? "NOT " : ""}NULL`);
      const readyWords = await count(remote, `words WHERE lang = '${lang}' AND image_status = 'ready' AND image_key IS NOT NULL`);
      const readyPhrases = p.is_kid ? 0 : await count(remote, `phrases WHERE lang = '${lang}' AND image_status = 'ready' AND image_key IS NOT NULL`);
      console.log(`  ${lang}: ${words} words, ${phrases} phrases (expected cards: recognition/listening = items, picture = items with a ready image)`);
      for (const [type, expectWords, expectPhrases] of [["recognition", words, phrases], ["listening", words, phrases], ["picture", readyWords, readyPhrases]] as const) {
        const [w, ph] = [await cardsOf(type, false), await cardsOf(type, true)];
        const ok = w === expectWords && ph === expectPhrases;
        console.log(`    ${ok ? "OK " : "MISSING"} ${type.padEnd(11)} word cards ${w}/${expectWords}, phrase cards ${ph}/${expectPhrases}`);
      }
    }
  }
  console.log("\nIf cards are missing, open the Home screen with that profile once (it runs syncProfileCards), then run --verify again.");
}

async function main() {
  console.log(verify ? "VERIFY (read-only)" : apply ? "APPLY: will write to PRODUCTION" : "DRY RUN: nothing is written");
  const remote = await openRemote();
  try {
    if (verify) return await runVerify(remote.env.DB);

    const local = await openLocal();
    try {
      await assertSameSchema(local.env.DB, remote.env.DB);
      const plan = planContent(await loadLocal(local.env.DB), await loadRemote(remote.env.DB));

      const [localObjects, remoteObjects] = [await listR2(local.env.MEDIA), await listR2(remote.env.MEDIA)];
      const remoteKeys = new Set(remoteObjects.map((o) => o.key));
      const toCopy = localObjects.filter((o) => !remoteKeys.has(o.key));
      const bytes = toCopy.reduce((n, o) => n + o.size, 0);
      const have = new Set([...localObjects.map((o) => o.key), ...remoteKeys]);
      const dangling = [...referencedKeys(plan)].filter((k) => !have.has(k));

      console.log("\nWords (local order):");
      for (const w of plan.wordStatus) console.log(`  ${w.status.padEnd(21)} ${w.lang} ${w.term}`);
      printCounts("Will insert:", countByTable(plan));
      const skippedBy = plan.skipped.reduce<Record<string, number>>((m, s) => ({ ...m, [s.table]: (m[s.table] ?? 0) + 1 }), {});
      printCounts("Will skip (production kept / already there):", Object.fromEntries(TABLES.map((t) => [t, skippedBy[t] ?? 0])));
      if (plan.skipped.length > 0) {
        console.log("\nSkipped rows:");
        for (const s of plan.skipped.filter((x) => x.table !== "ai_cache").slice(0, 80)) console.log(`  [${s.table}] ${s.label}: ${s.reason}`);
      }
      console.log(`\nR2: local ${localObjects.length} objects, production ${remoteObjects.length}; will copy ${toCopy.length} (${(bytes / 1024).toFixed(0)} KB), skip ${localObjects.length - toCopy.length} already there.`);
      if (dangling.length > 0) console.log(`WARNING: ${dangling.length} media keys referenced by rows to insert exist neither locally nor in production, e.g. ${dangling[0]}`);
      console.log("Never moved: profiles, profile_decks, cards, review_logs, usage_daily, pron_attempts. created_by_profile is set to NULL.");

      if (!apply) {
        console.log("\nDry run only. Check the lists above, then run again with --apply.");
        return;
      }

      // 1. Backups (production export + the local D1 files), before any write.
      backupProduction();
      const localCopy = path.join("backups", `local-d1-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      cpSync(path.resolve(".wrangler/state/v3/d1"), localCopy, { recursive: true });
      console.log(`Local D1 files copied to ${localCopy}`);

      const before = await tableCounts(remote.env.DB);
      const r2Before = remoteObjects.length;
      printCounts("Production BEFORE:", { ...before, r2_objects: r2Before });

      // 2. Media first, so no row ever points to a missing file.
      let copied = 0;
      for (const o of toCopy) {
        const obj = await local.env.MEDIA.get(o.key);
        if (!obj) continue;
        await remote.env.MEDIA.put(o.key, await obj.arrayBuffer(), { httpMetadata: o.httpMetadata, customMetadata: o.customMetadata });
        if (++copied % 20 === 0) console.log(`  media ${copied}/${toCopy.length}`);
      }
      console.log(`Media copied: ${copied}/${toCopy.length}`);

      // 3. Rows, parents before children; INSERT OR IGNORE keeps a re-run harmless.
      for (const table of TABLES) {
        const stmts = insertStatements(remote.env.DB, table, plan[table]);
        for (let i = 0; i < stmts.length; i += CHUNK) await remote.env.DB.batch(stmts.slice(i, i + CHUNK));
        console.log(`  ${table}: ${stmts.length} rows sent`);
      }

      const after = await tableCounts(remote.env.DB);
      const r2After = (await listR2(remote.env.MEDIA)).length;
      printCounts("Production AFTER:", { ...after, r2_objects: r2After });
      const expected = countByTable(plan);
      const off = TABLES.filter((t) => (after[t] ?? 0) - (before[t] ?? 0) !== expected[t]);
      console.log(off.length ? `\nWARNING: row counts differ from the plan for: ${off.join(", ")}` : "\nRow counts match the plan.");
      console.log("\nNext: open the app (Home) with profile Hiep once; syncProfileCards then creates cards for the new words. Then run with --verify.");
    } finally {
      await local.dispose();
    }
  } finally {
    await remote.dispose();
  }
}

await main();
