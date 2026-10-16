// One-off (M6.3): generates the answer explanation + key terms for existing TOPIK questions (AI
// call once per question, cached in ai_cache, never called again at practice time). Only processes
// questions that already have a vocabulary (M6.2's `npm run topik-words`) — the explanation's
// key_terms may only cite lemmas from that list.
//
//   npm run topik-explain                   dry run (default): counts rows to process, estimates AI calls
//   npm run topik-explain -- --apply        backs up production D1, then generates and writes
//   npm run topik-explain -- --apply --force   also redoes rows that already have an explanation
//   npm run topik-explain -- --apply --limit 10   processes at most 10 rows this run (resumable)
//   npm run topik-explain -- --apply --ids a,b,c  processes only these question ids (still pending)
//
// Idempotent: a row with `explain_checked_at` already set is skipped (unless --force), so the
// script can be stopped (Ctrl+C) and run again later, picking up where it left off.
//
// Needs `npx wrangler login` (for D1) and a local `.dev.vars` with LLM_API_KEY etc. (read directly;
// this is a plain local file, not a Cloudflare secret — see CLAUDE.md's "Secrets & security").
// Reaches production D1 through wrangler "remote bindings" (a temporary config; nothing in
// wrangler.jsonc changes), same as scripts/topikWords.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";
import type { TopikOptions, TopikVocabEntry } from "../../shared/topik";
import { checkTopikExplanation } from "../../worker/services/contentCheck";
import { createLlmClient, generateStructured, type LlmImagePart } from "../../worker/services/llm";
import { buildTopikExplainPrompt, TOPIK_EXPLAIN_PROMPT_VERSION, type ExplainInput } from "../../worker/services/topikExplainPrompt";
import { estimateCalls, questionHasContent, selectPending, type PendingRow } from "./plan";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> };
type D1Like = { prepare(sql: string): Stmt };
// Structural (not the ambient `R2Bucket`): scripts/ compiles without Workers types, same reason
// scripts/topikImport/run.ts has its own R2Like instead of importing worker/services/imageUpload.ts.
type R2ObjectLike = { arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } };
type R2Like = { get(key: string): Promise<R2ObjectLike | null> };

const PROD_DB_NAME = "lingo-family";
const PROD_MEDIA_BUCKET = "lingo-family-media";

const args = process.argv.slice(3);
const apply = args.includes("--apply");
const force = args.includes("--force");
const limitArg = args.find((_a, i) => args[i - 1] === "--limit");
const limit = limitArg ? Number(limitArg) : null;
const idsArg = args.find((_a, i) => args[i - 1] === "--ids");
const onlyIds = idsArg ? new Set(idsArg.split(",").map((s) => s.trim())) : null;

function tempConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-topik-explain-"));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "lingo-topik-explain",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: "10da2bc0-1ba1-4ae2-80be-df43cd5b1931", remote: true }],
      r2_buckets: [{ binding: "MEDIA", bucket_name: PROD_MEDIA_BUCKET, remote: true }],
    }),
  );
  return file;
}

function backupProduction() {
  mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `prod-d1-pre-topik-explain-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
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

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Mirrors worker/services/topikExplain.ts#resolveExplainImages against the structural `R2Like`. */
async function resolveExplainImages(bucket: R2Like, input: ExplainInput): Promise<{ images: LlmImagePart[] } | { error: string }> {
  const refs: { key: string; label: string }[] = [];
  if (input.stem.image_key) refs.push({ key: input.stem.image_key, label: "Hình ảnh đề bài:" });
  input.options.forEach((o, i) => {
    if (o.image_key) refs.push({ key: o.image_key, label: `Hình ảnh đáp án ${i + 1}:` });
  });
  if (refs.length === 0) return { images: [] };

  const images: LlmImagePart[] = [];
  for (const ref of refs) {
    const obj = await bucket.get(ref.key);
    if (!obj) return { error: `image ${ref.key} not found in R2` };
    const data = arrayBufferToBase64(await obj.arrayBuffer());
    const mimeType = obj.httpMetadata?.contentType ?? "image/webp";
    images.push({ label: ref.label, mimeType, data });
  }
  return { images };
}

/** Same tuple as worker/services/topikExplain.ts#topikExplainCacheKey. */
const cacheKey = (model: string, input: ExplainInput) =>
  sha256Hex(JSON.stringify(["topik-explain", TOPIK_EXPLAIN_PROMPT_VERSION, model, input.instruction, input.stem, input.options, input.correct_option, input.vocab]));

const llmTopikExplainSchema = z.object({ explanation_vi: z.string().min(1), key_terms: z.array(z.string()) });

type Row = {
  id: string;
  exam: string;
  number: number;
  instruction: string | null;
  stem_text: string | null;
  stem_image_key: string | null;
  options: string;
  correct_option: number;
  vocab: string | null;
  explain_checked_at: number | null;
};

async function loadRows(db: D1Like): Promise<PendingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, exam, number, instruction, stem_text, stem_image_key, options, correct_option, vocab, explain_checked_at
       FROM topik_questions WHERE vocab_checked_at IS NOT NULL ORDER BY exam, number`,
    )
    .all<Row>();
  return results.map((r) => ({
    id: r.id,
    exam: r.exam,
    number: r.number,
    instruction: r.instruction,
    stem_text: r.stem_text,
    stem_image_key: r.stem_image_key,
    options: JSON.parse(r.options) as TopikOptions,
    correct_option: r.correct_option,
    vocab: (r.vocab ? JSON.parse(r.vocab) : []) as TopikVocabEntry[],
    explain_checked_at: r.explain_checked_at,
  }));
}

function toExplainInput(row: PendingRow): ExplainInput {
  return {
    instruction: row.instruction,
    stem: { text: row.stem_text, image_key: row.stem_image_key },
    options: row.options,
    correct_option: row.correct_option,
    vocab: row.vocab,
  };
}

/** Generates (or reuses from ai_cache) one row's explanation; mirrors
 * worker/services/topikExplain.ts#generateTopikExplanationWithCache — not imported directly, see
 * the comment in ./plan.ts. Throws (never writes anything) instead of generating from a guess when
 * a stem/option image can't be fetched — "no explanation" beats a confidently-wrong one. */
async function processRow(
  db: D1Like,
  bucket: R2Like,
  llm: NonNullable<ReturnType<typeof createLlmClient>>,
  row: PendingRow,
): Promise<{ explanation_vi: string | null; key_terms: string[]; calledLlm: boolean }> {
  const input = toExplainInput(row);
  if (!questionHasContent(row)) return { explanation_vi: null, key_terms: [], calledLlm: false };

  const imageResult = await resolveExplainImages(bucket, input);
  if ("error" in imageResult) throw new Error(imageResult.error);

  const lemmas = row.vocab.map((v) => v.lemma);
  const allowedHangul = [...new Set(row.vocab.flatMap((v) => [v.surface, v.lemma]))];
  const key = await cacheKey(llm.model, input);
  const cached = await db.prepare("SELECT response_json FROM ai_cache WHERE key = ?1").bind(key).first<{ response_json: string }>();
  if (cached) {
    const parsed = z.object({ explanation_vi: z.string(), key_terms: z.array(z.string()) }).safeParse(JSON.parse(cached.response_json));
    if (parsed.success) return { ...parsed.data, calledLlm: false };
  }

  const { data, model } = await generateStructured(
    llm,
    llmTopikExplainSchema,
    { ...buildTopikExplainPrompt(input), images: imageResult.images },
    (d) => checkTopikExplanation(d, lemmas, allowedHangul),
  );
  const stillBadScript = checkTopikExplanation({ explanation_vi: data.explanation_vi, key_terms: [] }, [], allowedHangul).some((p) =>
    p.startsWith("explanation_vi:"),
  );
  if (stillBadScript) throw new Error(`explanation still has a script problem after retry (${row.exam} #${row.number})`);
  const key_terms = [...new Set(data.key_terms.filter((l) => lemmas.includes(l)))].slice(0, 5);
  const value = { explanation_vi: data.explanation_vi.trim(), key_terms };
  await db
    .prepare(
      `INSERT INTO ai_cache (key, response_json, model, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET response_json = excluded.response_json, model = excluded.model, created_at = excluded.created_at`,
    )
    .bind(key, JSON.stringify(value), model, Date.now())
    .run();
  return { ...value, calledLlm: true };
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
    const bucket = proxy.env.MEDIA as unknown as R2Like;
    const all = await loadRows(db);
    const pendingAll = selectPending(all, force);
    let pending = onlyIds ? pendingAll.filter((r) => onlyIds.has(r.id)) : pendingAll;
    if (limit) pending = pending.slice(0, limit);
    const calls = estimateCalls(pending);

    console.log(`\n${all.length} question(s) with a vocabulary, ${pendingAll.length} still need an explanation${force ? " (--force: includes already-done ones)" : ""}.`);
    if (onlyIds) {
      const missing = [...onlyIds].filter((id) => !pendingAll.some((r) => r.id === id));
      if (missing.length > 0) console.log(`Note: ${missing.length} of --ids are not pending (already done, not found, or have no vocabulary yet): ${missing.join(", ")}`);
    }
    console.log(`This run will process ${pending.length} of them, an estimated ${calls} Gemini call(s) (a question with nothing to explain is free).`);

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
      // of the batch: it is logged and skipped, left pending (explain_checked_at stays null), so a
      // later run of the same command picks it up again.
      let outcome: { explanation_vi: string | null; key_terms: string[]; calledLlm: boolean };
      try {
        outcome = await processRow(db, bucket, llm, row);
      } catch (e) {
        failed++;
        console.error(`  [skip] ${row.exam} #${row.number}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const { explanation_vi, key_terms, calledLlm } = outcome;
      await db
        .prepare("UPDATE topik_questions SET explanation_vi = ?1, key_terms = ?2, explain_checked_at = ?3 WHERE id = ?4")
        .bind(explanation_vi, JSON.stringify(key_terms), Date.now(), row.id)
        .run();
      done++;
      if (calledLlm) llmCalls++;
      else if (explanation_vi === null) empty++;
      console.log(`  [${done}/${pending.length}] ${row.exam} #${row.number}: ${key_terms.length} key term(s)${calledLlm ? "" : " (cached/free)"}`);
    }

    console.log(`\nProcessed ${done} question(s): ${llmCalls} real Gemini call(s) made (model: ${llm.model}), ${empty} had nothing to explain${failed ? `, ${failed} failed (skipped, still pending)` : ""}.`);
    const stillPending = selectPending(await loadRows(db), false).length;
    console.log(`Questions still without an explanation: ${stillPending}${stillPending > 0 ? " (run again, same command, to continue)" : ""}.`);
  } finally {
    await proxy.dispose();
  }
}

await main();
