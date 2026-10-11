// One-off (M2.7): assigns a creator to words/phrases moved from local that have no
// created_by_profile (e.g. via `npm run migrate:content`, which always sets it to NULL).
//
//   npm run assign-creator -- --profile <id>            dry run (default): lists what would change
//   npm run assign-creator -- --profile <id> --apply     backs up production D1, then writes
//
// Needs `npx wrangler login`. Only rows whose created_by_profile is still NULL are ever touched
// (re-running after an apply finds nothing left to do). Production is reached through wrangler
// "remote bindings" (a temporary config; nothing in wrangler.jsonc changes).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { countByTable, planAssignCreator, type CreatorRow } from "./plan";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> };
type D1Like = { prepare(sql: string): Stmt; batch(statements: Stmt[]): Promise<unknown[]> };

const PROD_DB_NAME = "lingo-family";
const CHUNK = 50;

const args = process.argv.slice(3);
const apply = args.includes("--apply");
const profileId = args.find((_a, i) => args[i - 1] === "--profile");

function tempConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-assign-creator-"));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "lingo-assign-creator",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: "10da2bc0-1ba1-4ae2-80be-df43cd5b1931", remote: true }],
    }),
  );
  return file;
}

function backupProduction() {
  mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `prod-d1-pre-assign-creator-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
  const r = spawnSync("npx", ["wrangler", "d1", "export", PROD_DB_NAME, "--remote", "--output", file], { stdio: "inherit", shell: true });
  if (r.status !== 0 || !existsSync(file) || statSync(file).size === 0) throw new Error("Production backup failed; nothing was changed.");
  console.log(`\nProduction D1 backed up to ${file} (${statSync(file).size} bytes)`);
}

const rows = async <T>(db: D1Like, sql: string) => (await db.prepare(sql).all<T>()).results;

async function loadRows(db: D1Like): Promise<CreatorRow[]> {
  const words = await rows<{ id: string; lang: string; term: string; created_by_profile: string | null; created_at: number }>(
    db,
    "SELECT id, lang, term, created_by_profile, created_at FROM words ORDER BY lang, term",
  );
  const phrases = await rows<{ id: string; lang: string; text: string; created_by_profile: string | null; created_at: number }>(
    db,
    "SELECT id, lang, text, created_by_profile, created_at FROM phrases ORDER BY lang, text",
  );
  return [
    ...words.map((w): CreatorRow => ({ table: "words", id: w.id, lang: w.lang, term: w.term, created_by_profile: w.created_by_profile, created_at: w.created_at })),
    ...phrases.map((p): CreatorRow => ({ table: "phrases", id: p.id, lang: p.lang, term: p.text, created_by_profile: p.created_by_profile, created_at: p.created_at })),
  ];
}

/** `created_at` on words/phrases is epoch ms (integer mode "timestamp_ms" in db/schema.ts). */
const isoOf = (epochMs: number) => new Date(epochMs).toISOString();

async function main() {
  if (!profileId) {
    console.error("Usage: npm run assign-creator -- --profile <profile id> [--apply]");
    process.exitCode = 1;
    return;
  }
  console.log(apply ? `APPLY: will set created_by_profile = ${profileId} on rows that are still NULL` : "DRY RUN: nothing is written");

  const configPath = tempConfig();
  const proxy = await getPlatformProxy({ configPath, remoteBindings: true });
  try {
    const db = proxy.env.DB as unknown as D1Like;
    const all = await loadRows(db);
    const plan = planAssignCreator(all);
    const counts = countByTable(plan.toUpdate);

    console.log(`\nWill assign (currently NULL): words ${counts.words}, phrases ${counts.phrases}`);
    if (plan.toUpdate.length > 0) {
      console.log("\nRows (table, id, text, lang, created_at):");
      for (const r of plan.toUpdate) console.log(`  ${r.table}\t${r.id}\t${r.term}\t${r.lang}\t${isoOf(r.created_at)}`);
    }
    console.log(`\nAlready have a creator (left untouched): ${plan.alreadySet.length}`);

    if (!apply) {
      console.log("\nDry run only. Check the list above, then run again with --apply.");
      return;
    }
    if (plan.toUpdate.length === 0) {
      console.log("\nNothing to do.");
      return;
    }

    backupProduction();

    const before = { words: counts.words, phrases: counts.phrases };
    const statements: Stmt[] = [
      db.prepare("UPDATE words SET created_by_profile = ? WHERE created_by_profile IS NULL").bind(profileId),
      db.prepare("UPDATE phrases SET created_by_profile = ? WHERE created_by_profile IS NULL").bind(profileId),
    ];
    for (let i = 0; i < statements.length; i += CHUNK) await db.batch(statements.slice(i, i + CHUNK));

    const stillNull = countByTable(planAssignCreator(await loadRows(db)).toUpdate);
    console.log(`\nBefore: words ${before.words} NULL, phrases ${before.phrases} NULL`);
    console.log(`After:  words ${stillNull.words} NULL, phrases ${stillNull.phrases} NULL (expected 0, 0)`);
    if (stillNull.words !== 0 || stillNull.phrases !== 0) console.log("WARNING: some rows are still NULL.");
    else console.log("All rows now have a creator.");
  } finally {
    await proxy.dispose();
  }
}

await main();
