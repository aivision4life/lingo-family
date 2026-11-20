// One-off (M8.1, SPEC F13): synthesises the speech a TOPIK listening podcast needs — the question
// number, the question line, the four options and the spoken answer — and stores it in R2 under
// the same content key the vocabulary's TTS uses, so nothing is ever generated twice.
//
//   npm run topik-podcast-tts                     dry run (default): counts files and characters
//   npm run topik-podcast-tts -- --apply          generates what is missing and writes the manifest
//   npm run topik-podcast-tts -- --apply --limit 50   at most 50 files this run (resumable)
//
// Why a script and not the app: during a podcast nothing may wait for Azure, and the Worker's own
// daily TTS quota (200/profile, `usage_daily`) is there to cap *practice*, not to build content.
// This runs outside it, like every other content script.
//
// It writes **no D1 rows at all** — the keys are the hash of the spoken text, so there is nothing
// to store and no migration. What it does write is the manifest (`podcast/tts-manifest.json`),
// which is how the Worker knows, in one read, which questions can be played; see
// `worker/services/topikPodcast.ts`.
//
// Needs `npx wrangler login` (for D1/R2) and a local `.dev.vars` with AZURE_SPEECH_KEY /
// AZURE_SPEECH_REGION, read directly as the other scripts do.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { PODCAST_MANIFEST_KEY, type PodcastManifest } from "../../shared/podcast";
import type { TopikOptions } from "../../shared/topik";
import { audioKey, createTtsClient, voiceFor } from "../../worker/services/tts";
import {
  charactersPerQuestion,
  F0_MIN_INTERVAL_MS,
  isRateLimited,
  planSpeech,
  RATE_LIMIT_ATTEMPTS,
  rateLimitDelayMs,
  totalCharacters,
  type PodcastRow,
} from "./plan";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> };
type D1Like = { prepare(sql: string): Stmt };
// Structural (not the ambient `R2Bucket`): scripts/ compiles without Workers types.
type R2Like = {
  head(key: string): Promise<{ size: number } | null>;
  put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

const PROD_DB_NAME = "lingo-family";
const PROD_MEDIA_BUCKET = "lingo-family-media";

const args = process.argv.slice(3);
const apply = args.includes("--apply");
const limitArg = args.find((_a, i) => args[i - 1] === "--limit");
const limit = limitArg ? Number(limitArg) : null;

function tempConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-topik-podcast-"));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "lingo-topik-podcast",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: "10da2bc0-1ba1-4ae2-80be-df43cd5b1931", remote: true }],
      r2_buckets: [{ binding: "MEDIA", bucket_name: PROD_MEDIA_BUCKET, remote: true }],
    }),
  );
  return file;
}

/** `.dev.vars` is a plain local file (KEY=VALUE per line), the same one `npm run dev` reads. */
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

/**
 * Questions a podcast could play: listening, approved, with a clip of their own whose exam's
 * audio an adult has approved. Mirrors `practisable()` in worker/routes/topik.ts — a question the
 * app would never serve must not have audio generated for it.
 */
async function loadRows(db: D1Like): Promise<PodcastRow[]> {
  const { results } = await db
    .prepare(
      `SELECT q.id, q.exam, q.number, q.instruction, q.options, q.correct_option
         FROM topik_questions q
        WHERE q.section = 'listening' AND q.verified = 1 AND q.segment_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM topik_audio a WHERE a.section = q.section AND a.exam = q.exam AND a.verified = 1)
        ORDER BY q.number, q.exam`,
    )
    .all<{ id: string; exam: string; number: number; instruction: string | null; options: string; correct_option: number }>();
  return results.map((r) => ({ ...r, options: JSON.parse(r.options) as TopikOptions }));
}

async function main() {
  console.log(apply ? `APPLY: will call Azure and write to production R2${limit ? ` (limit ${limit} file(s))` : ""}` : "DRY RUN: nothing is written");

  const devVars = readDevVars();
  const voice = voiceFor(devVars, "ko");
  const tts = createTtsClient(devVars);
  if (apply && !tts) {
    console.error("Azure Speech is not configured (AZURE_SPEECH_KEY / AZURE_SPEECH_REGION in .dev.vars). Nothing was done.");
    process.exitCode = 1;
    return;
  }

  const configPath = tempConfig();
  const proxy = await getPlatformProxy({ configPath, remoteBindings: true });
  try {
    const db = proxy.env.DB as unknown as D1Like;
    const bucket = proxy.env.MEDIA as unknown as R2Like;

    const rows = await loadRows(db);
    const { items, skipped } = planSpeech(rows);
    const keyed = await Promise.all(items.map(async (item) => ({ ...item, key: await audioKey("ko", voice, item.text) })));

    // Which of them R2 already has: a file is never regenerated, whatever made it.
    const present = new Set<string>();
    for (const item of keyed) if (await bucket.head(item.key)) present.add(item.key);
    const missing = keyed.filter((i) => !present.has(i.key));
    const todo = limit ? missing.slice(0, limit) : missing;

    console.log(`\nVoice: ${voice}`);
    console.log(`${rows.length} listening question(s) could be in a podcast; ${skipped.length} cannot be spoken (questions 1-3 with picture options, or a missing question line).`);
    console.log(`${keyed.length} distinct file(s) for ${rows.length - skipped.length} question(s) — the same question line and the same number are shared by every paper that uses them.`);
    console.log(`Characters: ${totalCharacters(keyed).toLocaleString("en-US")} to synthesise in total (${charactersPerQuestion(rows).toLocaleString("en-US")} without that sharing).`);
    console.log(`Already in R2: ${present.size}. Missing: ${missing.length} (${totalCharacters(missing).toLocaleString("en-US")} characters). This run would do ${todo.length}.`);
    console.log("Azure's free F0 tier allows 500,000 characters a month.");

    if (!apply) {
      console.log("\nDry run only. Check the counts above, then run again with --apply.");
      return;
    }

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    /**
     * One file, paced and retried.
     *
     * A 429 is the tier saying "too fast" and is worth waiting out (10 s, 20 s, 40 s, 80 s); any
     * other failure is this one file's problem and is left for the next run. Returns how it went
     * so the caller can decide whether the batch may continue at all.
     */
    async function synthesise(text: string): Promise<{ ok: true; audio: ArrayBuffer } | { ok: false; rateLimited: boolean; message: string }> {
      let message = "";
      for (let attempt = 1; attempt <= RATE_LIMIT_ATTEMPTS; attempt++) {
        try {
          return { ok: true, audio: await tts!.synthesize(text, "ko", voice) };
        } catch (e) {
          message = e instanceof Error ? e.message : String(e);
          if (!isRateLimited(message)) return { ok: false, rateLimited: false, message };
          if (attempt === RATE_LIMIT_ATTEMPTS) break;
          const wait = rateLimitDelayMs(attempt);
          console.log(`  [429] rate limited, waiting ${wait / 1000}s before retry ${attempt + 1}/${RATE_LIMIT_ATTEMPTS}…`);
          await sleep(wait);
        }
      }
      return { ok: false, rateLimited: true, message };
    }

    let done = 0;
    let failed = 0;
    let characters = 0;
    let stoppedBy: string | null = null;
    let lastCallAt = 0;

    for (const item of todo) {
      // Paced at F0's own limit (20 requests a minute) instead of discovering it with a 429.
      const since = Date.now() - lastCallAt;
      if (lastCallAt > 0 && since < F0_MIN_INTERVAL_MS) await sleep(F0_MIN_INTERVAL_MS - since);
      lastCallAt = Date.now();

      const result = await synthesise(item.text);
      if (!result.ok && result.rateLimited) {
        // Still refused after backing off four times: stop the whole run rather than hammer a
        // limit that is clearly not going to lift, and say so loudly at the end.
        stoppedBy = `Azure kept answering 429 after ${RATE_LIMIT_ATTEMPTS} attempts (${result.message}).`;
        break;
      }
      if (!result.ok) {
        // One file's own failure must not lose the batch: logged, left missing, picked up next run.
        failed++;
        console.error(`  [skip] ${item.text.slice(0, 40)}: ${result.message}`);
        if (failed >= 10) {
          stoppedBy = "10 files failed for reasons other than rate limiting; something else is wrong.";
          break;
        }
        continue;
      }

      await bucket.put(item.key, result.audio, { httpMetadata: { contentType: "audio/mpeg" } });
      present.add(item.key);
      done++;
      characters += item.text.length;
      console.log(`  [${done}/${todo.length}] ${item.text.slice(0, 40)}${item.text.length > 40 ? "…" : ""}`);
    }

    // The manifest is what the app reads: everything that exists now, not only what this run made.
    const manifest: PodcastManifest = {
      version: 1,
      generated_at: new Date().toISOString(),
      keys: keyed.filter((i) => present.has(i.key)).map((i) => i.key),
    };
    await bucket.put(PODCAST_MANIFEST_KEY, JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });

    const playable = rows.length - skipped.length;
    console.log(`
Generated ${done} file(s), ${characters.toLocaleString("en-US")} character(s) actually sent to Azure${failed ? `, ${failed} failed (still missing; run again)` : ""}.`);
    console.log(`Manifest written with ${manifest.keys.length} key(s); the podcast can now play the questions whose four files are all there (of ${playable}).`);
    if (stoppedBy) {
      console.error(`
STOPPED EARLY: ${stoppedBy}`);
      console.error(`${keyed.length - manifest.keys.length} file(s) are still missing. Nothing already made was lost — run the same command again later and it will skip everything that exists.`);
      process.exitCode = 1;
    }
  } finally {
    await proxy.dispose();
  }
}

await main();
