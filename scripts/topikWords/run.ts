// One-off (M6.2): generates the "tap a word" vocabulary for existing TOPIK questions (AI call once
// per question's full text, cached in ai_cache, never called again at practice time).
//
//   npm run topik-words                   dry run (default): counts rows to process, estimates AI calls
//   npm run topik-words -- --apply        backs up production D1, then generates and writes
//   npm run topik-words -- --apply --force   also redoes rows that already have a vocabulary
//   npm run topik-words -- --apply --limit 10   processes at most 10 rows this run (resumable)
//   npm run topik-words -- --apply --ids a,b,c  processes only these question ids (still pending)
//
// Idempotent: a row with `vocab_checked_at` already set is skipped (unless --force), so the script
// can be stopped (Ctrl+C) and run again later, picking up where it left off.
//
// Needs `npx wrangler login` (for D1) and a local `.dev.vars` with LLM_API_KEY etc. (read directly;
// this is a plain local file, not a Cloudflare secret — see CLAUDE.md's "Secrets & security").
// Reaches production D1 through wrangler "remote bindings" (a temporary config; nothing in
// wrangler.jsonc changes), same as scripts/assignCreator and scripts/topikImport.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";
import { topikVocabEntrySchema, topikVocabListSchema, type TopikOptions, type TopikVocabEntry } from "../../shared/topik";
import { checkTopikVocabEntry } from "../../worker/services/contentCheck";
import { createLlmClient, generateStructured } from "../../worker/services/llm";
import { buildTopikVocabPrompt, TOPIK_VOCAB_PROMPT_VERSION } from "../../worker/services/topikWordPrompt";
import { estimateCalls, questionVocabText, selectPending, type PendingRow } from "./plan";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> };
type D1Like = { prepare(sql: string): Stmt };

const PROD_DB_NAME = "lingo-family";

const args = process.argv.slice(3);
const apply = args.includes("--apply");
const force = args.includes("--force");
const limitArg = args.find((_a, i) => args[i - 1] === "--limit");
const limit = limitArg ? Number(limitArg) : null;
const idsArg = args.find((_a, i) => args[i - 1] === "--ids");
const onlyIds = idsArg ? new Set(idsArg.split(",").map((s) => s.trim())) : null;

function tempConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-topik-words-"));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "lingo-topik-words",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: "10da2bc0-1ba1-4ae2-80be-df43cd5b1931", remote: true }],
    }),
  );
  return file;
}

function backupProduction() {
  mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `prod-d1-pre-topik-words-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
  const r = spawnSync("npx", ["wrangler", "d1", "export", PROD_DB_NAME, "--remote", "--output", file], { stdio: "inherit", shell: true });
  if (r.status !== 0 || !existsSync(file) || statSync(file).size === 0) throw new Error("Production backup failed; nothing was changed.");
  console.log(`\nProduction D1 backed up to ${file} (${statSync(file).size} bytes)`);
}

/** `.dev.vars` is a plain local file (KEY=VALUE, one per line; '#' comments, blank lines skipped) —
 * not a Cloudflare secret, so reading it directly here is fine (same key used by `npm run dev`). */
function readDevVars(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(".dev.vars")) return out;
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (text: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

const cacheKey = (model: string, text: string) =>
  sha256Hex(JSON.stringify(["topik-vocab", TOPIK_VOCAB_PROMPT_VERSION, model, text]));

const llmTopikVocabSchema = z.object({ words: z.array(topikVocabEntrySchema) });

/** Same dedupe-by-lemma + content-check rule as worker/services/topikWord.ts#finalizeTopikVocab. */
function finalizeVocab(logContext: string, raw: TopikVocabEntry[]): TopikVocabEntry[] {
  const out: TopikVocabEntry[] = [];
  const seenLemmas = new Set<string>();
  for (const e of raw) {
    const entry: TopikVocabEntry = { surface: e.surface.trim(), lemma: e.lemma.trim(), pos: e.pos, gloss_vi: e.gloss_vi.trim() };
    if (seenLemmas.has(entry.lemma)) continue;
    const problems = checkTopikVocabEntry(entry);
    if (problems.length > 0) {
      console.error(`  [drop] "${entry.surface}" (${logContext}): ${problems.join("; ")}`);
      continue;
    }
    seenLemmas.add(entry.lemma);
    out.push(entry);
  }
  return out;
}

type Row = { id: string; exam: string; number: number; stem_text: string | null; options: string; vocab_checked_at: number | null };

async function loadRows(db: D1Like): Promise<PendingRow[]> {
  const { results } = await db
    .prepare("SELECT id, exam, number, stem_text, options, vocab_checked_at FROM topik_questions ORDER BY exam, number")
    .all<Row>();
  return results.map((r) => ({ ...r, options: JSON.parse(r.options) as TopikOptions }));
}

/** Generates (or reuses from ai_cache) one row's vocabulary; a count of 0 means an ai_cache hit or
 * nothing to tokenize (both free). Mirrors worker/services/topikWord.ts#generateTopikVocabWithCache
 * — not imported directly, see the comment in ./plan.ts. */
async function processRow(
  db: D1Like,
  llm: NonNullable<ReturnType<typeof createLlmClient>>,
  row: PendingRow,
): Promise<{ vocab: TopikVocabEntry[]; calledLlm: boolean }> {
  const text = questionVocabText(row);
  if (text.trim() === "") return { vocab: [], calledLlm: false };

  const key = await cacheKey(llm.model, text);
  const cached = await db.prepare("SELECT response_json FROM ai_cache WHERE key = ?1").bind(key).first<{ response_json: string }>();
  if (cached) {
    const parsed = topikVocabListSchema.safeParse(JSON.parse(cached.response_json));
    if (parsed.success) return { vocab: parsed.data, calledLlm: false };
  }

  const { data, model } = await generateStructured(
    llm,
    llmTopikVocabSchema,
    buildTopikVocabPrompt(text),
    (d) => d.words.flatMap((w, i) => checkTopikVocabEntry(w).map((x) => `words[${i}]: ${x}`)),
  );
  const vocab = finalizeVocab(`${row.exam} #${row.number}`, data.words);
  await db
    .prepare(
      `INSERT INTO ai_cache (key, response_json, model, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET response_json = excluded.response_json, model = excluded.model, created_at = excluded.created_at`,
    )
    .bind(key, JSON.stringify(vocab), model, Date.now())
    .run();
  return { vocab, calledLlm: true };
}

async function main() {
  console.log(apply ? `APPLY${force ? " --force" : ""}: will write to production${limit ? ` (limit ${limit})` : ""}` : "DRY RUN: nothing is written");

  const devVars = readDevVars();
  const llm = createLlmClient({
    LLM_PROVIDER: devVars.LLM_PROVIDER,
    LLM_MODEL: devVars.LLM_MODEL,
    LLM_FALLBACK_MODEL: devVars.LLM_FALLBACK_MODEL,
    LLM_API_KEY: devVars.LLM_API_KEY,
  });
  if (!llm) {
    console.error("No LLM configured (check LLM_API_KEY / LLM_PROVIDER in .dev.vars). Nothing to do.");
    process.exitCode = 1;
    return;
  }

  const configPath = tempConfig();
  const proxy = await getPlatformProxy({ configPath, remoteBindings: true });
  try {
    const db = proxy.env.DB as unknown as D1Like;
    const all = await loadRows(db);
    const pendingAll = selectPending(all, force);
    let pending = onlyIds ? pendingAll.filter((r) => onlyIds.has(r.id)) : pendingAll;
    if (limit) pending = pending.slice(0, limit);
    const calls = estimateCalls(pending);

    console.log(`\n${all.length} question(s) total, ${pendingAll.length} still need a vocabulary${force ? " (--force: includes already-done ones)" : ""}.`);
    if (onlyIds) {
      const missing = [...onlyIds].filter((id) => !pendingAll.some((r) => r.id === id));
      if (missing.length > 0) console.log(`Note: ${missing.length} of --ids are not pending (already done, or not found): ${missing.join(", ")}`);
    }
    console.log(`This run will process ${pending.length} of them, an estimated ${calls} Gemini call(s) (a question with nothing to tokenize is free).`);

    if (!apply) {
      console.log("\nDry run only. Check the counts above, then run again with --apply.");
      return;
    }
    if (pending.length === 0) {
      console.log("\nNothing to do.");
      return;
    }

    backupProduction();

    let done = 0;
    let llmCalls = 0;
    let empty = 0;
    let failed = 0;
    for (const row of pending) {
      // A single row's failure (e.g. Gemini briefly overloaded) must not lose progress on the rest
      // of the batch: it is logged and skipped, left pending (vocab_checked_at stays null), so a
      // later run of the same command picks it up again — same idempotent-retry spirit as images.
      let outcome: { vocab: TopikVocabEntry[]; calledLlm: boolean };
      try {
        outcome = await processRow(db, llm, row);
      } catch (e) {
        failed++;
        console.error(`  [skip] ${row.exam} #${row.number}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const { vocab, calledLlm } = outcome;
      await db
        .prepare("UPDATE topik_questions SET vocab = ?1, vocab_checked_at = ?2 WHERE id = ?3")
        .bind(JSON.stringify(vocab), Date.now(), row.id)
        .run();
      done++;
      if (calledLlm) llmCalls++;
      else if (vocab.length === 0) empty++;
      console.log(`  [${done}/${pending.length}] ${row.exam} #${row.number}: ${vocab.length} word(s)${calledLlm ? "" : " (cached/free)"}`);
    }

    console.log(`\nProcessed ${done} question(s): ${llmCalls} real Gemini call(s) made (model: ${llm.model}), ${empty} had nothing to tokenize${failed ? `, ${failed} failed (skipped, still pending)` : ""}.`);
    const stillPending = selectPending(await loadRows(db), false).length;
    console.log(`Questions still without a vocabulary: ${stillPending}${stillPending > 0 ? " (run again, same command, to continue)" : ""}.`);
  } finally {
    await proxy.dispose();
  }
}

await main();
