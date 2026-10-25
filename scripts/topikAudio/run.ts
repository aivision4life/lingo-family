// One-off (M7.1): proposes the clip boundaries of a TOPIK listening paper from its single mp3, by
// asking ffmpeg where the silences are, and checks that count against the questions in the Word
// files. Reads data/topik-audio/*.mp3 (gitignored, copyrighted) and data/topik/*.docx.
//
//   npm run topik-audio                     dry run (default): prints the proposed segments
//   npm run topik-audio -- --apply          backs up production D1, uploads the mp3, writes the segments
//   npm run topik-audio -- --apply --force  also replaces an exam's existing audio + segments
//   npm run topik-audio -- --exam 8DeOfficial-60회   only this exam
//
// An exam's audio ALWAYS lands unverified, so none of its questions reach practice until an adult
// has checked the boundaries in Settings → TOPIK. When the number of clips found does not match
// what the Word files expect, the questions are not linked to segments at all: assigning them in
// order would put everything after the miscount onto the wrong clip while still playing perfectly
// normal audio, which is the hardest kind of mistake to notice.
//
// mp3 naming: TOPIK_Listening_<source>_<round>.mp3 → the exam label its questions carry
// ("TOPIK_Listening_8DeOfficial_60회.mp3" → "8DeOfficial-60회").
//
// Needs ffmpeg + ffprobe on PATH, and `npx wrangler login` for --apply.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { getPlatformProxy } from "wrangler";
import { buildImportDraft } from "../../worker/services/topikImport";
import {
  buildSegments,
  examFromAudioName,
  formatMs,
  parseSilenceLog,
  pickIntroEnd,
  planAudio,
  type AudioPlan,
  type Segment,
} from "./plan";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> };
type D1Like = { prepare(sql: string): Stmt; batch(statements: Stmt[]): Promise<unknown> };
// Structural, not the ambient `R2Bucket`: scripts/ compiles without Workers types, the same reason
// scripts/topikImport/run.ts keeps its own copy (see CLAUDE.md's lesson on ambient types).
type R2Like = { head(key: string): Promise<unknown>; put(key: string, body: Uint8Array, opts: unknown): Promise<unknown> };

const AUDIO_DIR = "data/topik-audio";
const DOCX_DIR = "data/topik";
const PROD_DB_NAME = "lingo-family";
const PROD_MEDIA_BUCKET = "lingo-family-media";

/** Silence quieter than this, for at least this long, may separate two clips. */
const SILENCE_DB = -35;
const SILENCE_MIN_S = 1.0;
/** The spoken introduction is looked for in the first two minutes only. */
const INTRO_WINDOW_MS = 120_000;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const force = args.includes("--force");
const examFilter = args[args.indexOf("--exam") + 1];
const onlyExam = args.includes("--exam") ? examFilter : undefined;

function ffprobeDurationMs(file: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr || r.error?.message}`);
  return Math.round(Number(r.stdout.trim()) * 1000);
}

function ffmpegSilenceLog(file: string): string {
  // silencedetect writes to stderr; -f null discards the decoded audio.
  const r = spawnSync("ffmpeg", ["-i", file, "-af", `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_MIN_S}`, "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw new Error(`ffmpeg failed for ${file}: ${r.error.message}`);
  return r.stderr ?? "";
}

/** Every listening question of one exam, gathered from all the Word files that mention it. */
async function listeningQuestions(exam: string) {
  if (!existsSync(DOCX_DIR)) return [];
  const files = (await readdir(DOCX_DIR)).filter((f) => f.toLowerCase().endsWith(".docx") && !f.startsWith("~$"));
  const questions: { number: number; same_segment: boolean; file: string }[] = [];
  for (const fileName of files) {
    const zip = await JSZip.loadAsync(await readFile(path.join(DOCX_DIR, fileName)));
    const documentXml = await zip.file("word/document.xml")?.async("string");
    if (!documentXml) continue;
    for (const q of buildImportDraft(fileName, documentXml).questions) {
      if (q.section === "listening" && q.exam === exam) questions.push({ number: q.number, same_segment: q.same_segment, file: fileName });
    }
  }
  return questions;
}

function tempConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-topik-audio-"));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "lingo-topik-audio",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: "10da2bc0-1ba1-4ae2-80be-df43cd5b1931", remote: true }],
      r2_buckets: [{ binding: "MEDIA", bucket_name: PROD_MEDIA_BUCKET, remote: true }],
    }),
  );
  return file;
}

function backupProduction() {
  mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `prod-d1-pre-topik-audio-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
  const r = spawnSync("npx", ["wrangler", "d1", "export", PROD_DB_NAME, "--remote", "--output", file], { stdio: "inherit", shell: true });
  if (r.status !== 0 || !existsSync(file) || statSync(file).size === 0) throw new Error("Production backup failed; nothing was changed.");
  console.log(`\nProduction D1 backed up to ${file} (${statSync(file).size} bytes)`);
}

const sha1Hex = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes.buffer as ArrayBuffer))].map((b) => b.toString(16).padStart(2, "0")).join("");

type ExamPlan = {
  exam: string;
  file: string;
  fileSize: number;
  durationMs: number;
  plan: AudioPlan;
  questions: { number: number; same_segment: boolean; file: string }[];
};

function report(p: ExamPlan) {
  console.log(`\n=== ${p.exam} — ${path.basename(p.file)} ===`);
  console.log(
    `  ${(p.fileSize / 1024 / 1024).toFixed(1)} MB, ${formatMs(p.durationMs)} long, ` +
      `${p.plan.segments.length} segment(s) found, ${p.plan.expected} expected from ${p.questions.length} question(s)`,
  );
  for (const problem of p.plan.problems) console.log(`  PROBLEM: ${problem}`);
  if (p.questions.length === 0) console.log("  PROBLEM: no listening questions found for this exam in data/topik/");

  const byNumber = [...p.plan.assignment].sort((a, b) => a[0] - b[0]);
  const questionsOf = (idx: number) => byNumber.filter(([, s]) => s === idx).map(([n]) => `#${n}`);
  for (const s of p.plan.segments.slice(0, 60)) {
    const qs = questionsOf(s.idx);
    console.log(
      `  ${String(s.idx).padStart(3)}  ${formatMs(s.start_ms)} → ${formatMs(s.speech_end_ms)} (hết tiếng) → ${formatMs(s.end_ms)}` +
        `   ${qs.length > 0 ? qs.join(", ") : "(chưa gán câu)"}`,
    );
  }
  if (p.plan.segments.length > 60) console.log(`  … ${p.plan.segments.length - 60} more`);
}

async function writeExam(db: D1Like, bucket: R2Like, p: ExamPlan) {
  const bytes = new Uint8Array(readFileSync(p.file));
  const key = `topik/audio/${await sha1Hex(bytes)}.mp3`;
  if (!(await bucket.head(key))) await bucket.put(key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });

  const existing = await db.prepare("SELECT id FROM topik_audio WHERE section = 'listening' AND exam = ?").bind(p.exam).first<{ id: string }>();
  if (existing && !force) {
    console.log(`  SKIPPED: ${p.exam} already has audio (use --force to replace it)`);
    return { inserted: 0, replaced: 0 };
  }
  // Replacing deletes the old segments (cascade), which also clears every question's segment_id
  // (set null) — the questions and their review history stay.
  if (existing) await db.prepare("DELETE FROM topik_audio WHERE id = ?").bind(existing.id).run();

  const audioId = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO topik_audio (id, section, exam, audio_key, duration_ms, verified, created_at, updated_at)
       VALUES (?, 'listening', ?, ?, ?, 0, ?, ?)`,
    )
    .bind(audioId, p.exam, key, p.durationMs, now, now)
    .run();

  const segmentIds = new Map<number, string>();
  const statements = p.plan.segments.map((s: Segment) => {
    const id = crypto.randomUUID();
    segmentIds.set(s.idx, id);
    return db
      .prepare("INSERT INTO topik_segments (id, audio_id, idx, start_ms, speech_end_ms, end_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, audioId, s.idx, s.start_ms, s.speech_end_ms, s.end_ms, now);
  });
  if (statements.length > 0) await db.batch(statements);

  for (const [number, idx] of p.plan.assignment) {
    await db
      .prepare("UPDATE topik_questions SET segment_id = ? WHERE section = 'listening' AND exam = ? AND number = ?")
      .bind(segmentIds.get(idx)!, p.exam, number)
      .run();
  }
  console.log(
    `  ${existing ? "REPLACED" : "WROTE"} ${p.exam}: ${p.plan.segments.length} segment(s), ` +
      `${p.plan.assignment.size} question link(s), audio ${key} — unverified until you approve it`,
  );
  return { inserted: existing ? 0 : 1, replaced: existing ? 1 : 0 };
}

async function main() {
  if (!existsSync(AUDIO_DIR)) {
    console.error(`No ${AUDIO_DIR} directory — put the exam mp3s there first.`);
    return;
  }
  const files = (await readdir(AUDIO_DIR)).filter((f) => f.toLowerCase().endsWith(".mp3"));
  if (files.length === 0) {
    console.log(`No .mp3 files in ${AUDIO_DIR}.`);
    return;
  }
  console.log(apply ? `APPLY${force ? " --force" : ""}: will write to production` : "DRY RUN: nothing is written");

  const plans: ExamPlan[] = [];
  for (const fileName of files) {
    const exam = examFromAudioName(fileName);
    if (!exam) {
      console.log(`\n=== ${fileName} ===\n  PROBLEM: name does not match "TOPIK_Listening_<source>_<round>.mp3"`);
      continue;
    }
    if (onlyExam && exam !== onlyExam) continue;

    const file = path.join(AUDIO_DIR, fileName);
    const durationMs = ffprobeDurationMs(file);
    const silences = parseSilenceLog(ffmpegSilenceLog(file), durationMs);
    const introEnd = pickIntroEnd(silences, INTRO_WINDOW_MS);
    const segments = buildSegments(silences, durationMs, introEnd);
    const questions = await listeningQuestions(exam);
    plans.push({ exam, file, fileSize: statSync(file).size, durationMs, plan: planAudio(segments, questions, durationMs), questions });
  }

  for (const p of plans) report(p);
  const clean = plans.filter((p) => p.plan.problems.length === 0 && p.questions.length > 0);
  console.log(`\nTotal: ${plans.length} exam(s), ${clean.length} with boundaries that match the Word files.`);
  console.log("Every exam is stored UNVERIFIED; approve it in Settings → TOPIK before practice uses it.");
  if (!apply) {
    console.log("\nDry run only. Check the report above, then run again with --apply.");
    return;
  }

  backupProduction();
  const configPath = tempConfig();
  const proxy = await getPlatformProxy({ configPath, remoteBindings: true });
  try {
    const db = proxy.env.DB as unknown as D1Like;
    const bucket = proxy.env.MEDIA as unknown as R2Like;
    let inserted = 0;
    let replaced = 0;
    for (const p of plans) {
      const r = await writeExam(db, bucket, p);
      inserted += r.inserted;
      replaced += r.replaced;
    }
    console.log(`\nWrote ${inserted} new exam audio, replaced ${replaced}.`);
  } finally {
    await proxy.dispose();
  }
}

await main();
