// One-off repair (M7.6): recompute `speech_end_ms` for clips that were cut before the cutter
// carried a short announcement's speech end over (`mergeShortSegments`).
//
//   npm run topik-speech-end                     dry run: the full table, nothing written
//   npm run topik-speech-end -- --apply          backs up production D1, then writes
//   npm run topik-speech-end -- --local          read/write the local dev D1 instead
//   npm run topik-speech-end -- --exam OfficialTest-35회    only this exam
//
// **Only `speech_end_ms` is ever written.** `start_ms`, `end_ms`, the audio row and `verified` are
// never touched: the boundaries were reviewed by hand, and nothing here is a better judge of them
// than the person who listened to them. Each clip's new speech end is measured *inside* its own
// stored boundaries, so a hand-adjusted clip stays hand-adjusted.
//
// Needs ffmpeg on PATH and the exam's mp3 in data/topik-audio (gitignored, copyrighted).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { examFromAudioName, formatMs, lastSpeechEnd, parseSilenceLog, type Silence } from "../topikAudio/plan";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
type D1Like = { prepare(sql: string): Stmt; batch(statements: Stmt[]): Promise<unknown> };

const AUDIO_DIR = "data/topik-audio";
const PROD_DB_NAME = "lingo-family";
/** The same sensitive threshold the cutter uses, so "speech" means the same thing it did. */
const NOISE_DB = -35;
const DETECT_SILENCE_S = 1.2;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const local = args.includes("--local");
const only = args[args.indexOf("--exam") + 1];
const examFilter = args.includes("--exam") ? only : undefined;

type Row = { id: string; idx: number; start_ms: number; speech_end_ms: number; end_ms: number };
type Change = { row: Row; next: number };

function silencesOf(file: string): Silence[] {
  const r = spawnSync("ffmpeg", ["-i", file, "-af", `silencedetect=noise=${NOISE_DB}dB:d=${DETECT_SILENCE_S}`, "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw new Error(`ffmpeg failed for ${file}: ${r.error.message}`);
  // The duration only bounds a silence that runs to the end of the file; a generous value is safe
  // because every clip is bounded by its own stored end_ms anyway.
  return parseSilenceLog(r.stderr ?? "", Number.MAX_SAFE_INTEGER);
}

function tempConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-topik-speech-"));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "lingo-topik-speech-end",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: "10da2bc0-1ba1-4ae2-80be-df43cd5b1931", remote: true }],
    }),
  );
  return file;
}

function backupProduction() {
  mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `prod-d1-pre-speech-end-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
  const r = spawnSync("npx", ["wrangler", "d1", "export", PROD_DB_NAME, "--remote", "--output", file], { stdio: "inherit", shell: true });
  if (r.status !== 0 || !existsSync(file) || statSync(file).size === 0) throw new Error("Production backup failed; nothing was changed.");
  console.log(`\nProduction D1 backed up to ${file} (${statSync(file).size} bytes)`);
}

async function main() {
  if (!existsSync(AUDIO_DIR)) throw new Error(`${AUDIO_DIR} not found — the exam mp3s live there (gitignored).`);
  console.log(apply ? `WRITING to ${local ? "local" : "PRODUCTION"} D1 — only speech_end_ms` : "DRY RUN: nothing is written");

  const proxy = local ? await getPlatformProxy({ remoteBindings: false }) : await getPlatformProxy({ configPath: tempConfig(), remoteBindings: true });
  try {
    const db = proxy.env.DB as unknown as D1Like;
    const changes: Change[] = [];
    let scanned = 0;

    for (const fileName of readdirSync(AUDIO_DIR).filter((f) => f.toLowerCase().endsWith(".mp3"))) {
      const named = examFromAudioName(fileName);
      if (!named.ok) continue;
      if (examFilter && named.exam !== examFilter) continue;

      const { results: segments } = await db
        .prepare(
          `SELECT s.id, s.idx, s.start_ms, s.speech_end_ms, s.end_ms
             FROM topik_segments s JOIN topik_audio a ON a.id = s.audio_id
            WHERE a.exam = ? AND a.section = 'listening' ORDER BY s.idx`,
        )
        .bind(named.exam)
        .all<Row>();
      if (segments.length === 0) {
        console.log(`\n=== ${named.exam} ===\n  no clips stored — nothing to repair.`);
        continue;
      }

      const silences = silencesOf(path.join(AUDIO_DIR, fileName));
      console.log(`\n=== ${named.exam} === (${segments.length} clips, ${fileName})`);
      console.log("  idx   speech_end cũ   mới           chênh      trong đoạn (dài)");
      for (const row of segments) {
        scanned += 1;
        const next = lastSpeechEnd(silences, row.start_ms, row.end_ms);
        const delta = next === null ? 0 : next - row.speech_end_ms;
        const mark = next === null ? "KHÔNG CÓ TIẾNG" : Math.abs(delta) < 250 ? "" : `${delta > 0 ? "+" : ""}${(delta / 1000).toFixed(1)}s`;
        console.log(
          `  ${String(row.idx).padEnd(4)}  ${formatMs(row.speech_end_ms).padEnd(13)} ${(next === null ? "-" : formatMs(next)).padEnd(13)} ` +
            `${mark.padEnd(9)}  ${((row.end_ms - row.start_ms) / 1000).toFixed(0)}s`,
        );
        // A quarter of a second is below what any ear judges; it is detector noise, not a repair.
        if (next !== null && Math.abs(delta) >= 250) changes.push({ row, next });
      }
    }

    console.log(`\nTotal: ${scanned} clip(s) scanned, ${changes.length} would change.`);
    if (changes.length === 0 || !apply) {
      if (!apply) console.log("\nDry run only. Check the table above, then run again with --apply.");
      return;
    }

    if (!local) backupProduction();
    // One statement per clip, two parameters each: far below D1's ceiling, and a failure part way
    // through leaves the rest exactly as they were.
    await db.batch(changes.map((c) => db.prepare("UPDATE topik_segments SET speech_end_ms = ? WHERE id = ?").bind(c.next, c.row.id)));
    console.log(`\nUpdated speech_end_ms on ${changes.length} clip(s). No boundary, no audio row and no approval was touched.`);
  } finally {
    await proxy.dispose();
  }
}

await main();
