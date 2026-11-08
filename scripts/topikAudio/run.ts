// One-off (M7.1): proposes the clip boundaries of a TOPIK listening paper from its single mp3, by
// asking ffmpeg where the silences are, and checks that count against the questions in the Word
// files. Reads data/topik-audio/*.mp3 (gitignored, copyrighted) and data/topik/*.docx.
//
//   npm run topik-audio                     dry run (default): prints the proposed segments
//   npm run topik-audio -- --apply          backs up production D1, uploads the mp3, writes the segments
//   npm run topik-audio -- --apply --force  also replaces an exam's existing audio + segments
//   npm run topik-audio -- --apply --local         writes to the local dev D1/R2 instead (try it out first)
//   npm run topik-audio -- --exam 8DeOfficial-60회   only this exam
//   npm run topik-audio -- --exam ... --intro 2:22.253   where the spoken introduction ends
//
// `--intro` is REQUIRED for every exam, and there is no automatic fallback: see
// `plan.ts#estimateIntroEnd` for the eight papers that killed the old detector. Run the command
// once without it and it stops, having cut a 14-second sample at the mark it proposes (with the
// mark at second 6) into data/topik-audio/_check/ and printed the silences around it. Listen,
// then run it again with `--intro`. Nothing is read from D1 and nothing is written on that first
// run.
//   npm run topik-audio -- --link-only              attach newly imported questions to clips that
//                                                   already exist; no mp3, no re-cutting, no
//                                                   approval lost (see `planLinks`)
//
// An exam's audio ALWAYS lands unverified, so none of its questions reach practice until an adult
// has checked the boundaries in Settings → TOPIK. When the number of clips found does not match
// what the Word files expect, the questions are not linked to segments at all: assigning them in
// order would put everything after the miscount onto the wrong clip while still playing perfectly
// normal audio, which is the hardest kind of mistake to notice.
//
// mp3 naming: TOPIK_Listening_<source>_Test<N>.mp3. File names stay ASCII, exam labels stay
// Korean, and `plan.ts#examFromAudioName` is the single place the two meet:
// "TOPIK_Listening_OfficialTest_Test35.mp3" → "OfficialTest-35회". A name it cannot read is an
// error, never a guessed label.
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
  boundarySilences,
  buildSegments,
  examFromAudioName,
  mergeShortSegments,
  formatMs,
  parseSilenceLog,
  countHangul,
  estimateIntroEnd,
  silencesNear,
  planAudio,
  planLinks,
  silenceHistogram,
  type AudioPlan,
  type LinkPlan,
  type Segment,
  type Silence,
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

/**
 * A pause quieter than `--noise` dB and at least `--silence` seconds long ends a clip. Measured on
 * a real paper: pauses inside a dialogue are 1-2s and the gap for answering is 15-18s, with
 * nothing in between, so 5s sits in the middle of a very wide empty band. The report prints the
 * whole distribution, so if another paper is paced differently it shows rather than guessing.
 */
const DEFAULT_NOISE_DB = -35;
const DEFAULT_SILENCE_S = 5;
/**
 * Detection itself runs sensitive. 0.2s is not a comfort margin: "no silence at all above 0.2s in
 * the first 100 seconds" is the one signal that identifies a paper whose introduction is covered by
 * background music (4 of 8 papers), and `estimateIntroEnd` snaps its proposal onto this same list,
 * which is what gets it within milliseconds of the mark a human picks.
 */
const DETECT_SILENCE_S = 0.2;
/**
 * A "clip" with less speech than this is the narrator announcing the second question of a pair,
 * not a clip (see plan.ts `mergeShortSegments`). Real clips in the measured paper are 14s+, the
 * announcements ~1s, so 5s sits in the middle of a very wide gap.
 */
const DEFAULT_MIN_SPEECH_S = 5;
/** The sample cut at the proposed mark: 14 seconds, with the mark itself at second 6. */
const CHECK_CLIP_S = 14;
const CHECK_CLIP_LEAD_S = 6;
/** Where those samples go. Gitignored with the rest of data/, and never scanned for mp3s. */
const CHECK_DIR = "data/topik-audio/_check";
/** How far either side of the proposal to list real silences, so another mark can be picked at once. */
const CHECK_SILENCE_WINDOW_MS = 12_000;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
/** Write to the dev server's own D1/R2 (.wrangler/state) instead of production. */
const local = args.includes("--local");
const force = args.includes("--force");
/** Only write `topik_questions.segment_id`; never touch the mp3, the clips or their approval. */
const linkOnly = args.includes("--link-only");
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const onlyExam = flag("--exam");
const noiseDb = Number(flag("--noise") ?? DEFAULT_NOISE_DB);
const silenceMs = Math.round(Number(flag("--silence") ?? DEFAULT_SILENCE_S) * 1000);
/** "01:42.487" or "102.487" → ms, for --intro when the automatic guess lands in the wrong place. */
function parseTime(text: string): number {
  const [m, sec] = text.includes(":") ? text.split(":") : ["0", text];
  return Math.round((Number(m) * 60 + Number(sec)) * 1000);
}
const introOverride = flag("--intro") ? parseTime(flag("--intro")!) : undefined;
const minSpeechMs = Math.round(Number(flag("--min-speech") ?? DEFAULT_MIN_SPEECH_S) * 1000);

function ffprobeDurationMs(file: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr || r.error?.message}`);
  return Math.round(Number(r.stdout.trim()) * 1000);
}

function ffmpegSilenceLog(file: string): string {
  // One pass at the sensitive threshold: the long gaps are filtered out of this same list, while
  // the short pause after the instructions stays visible for the intro guess.
  const detect = Math.min(DETECT_SILENCE_S, silenceMs / 1000);
  // silencedetect writes to stderr; -f null discards the decoded audio.
  const r = spawnSync("ffmpeg", ["-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${detect}`, "-f", "null", "-"], {
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
  const questions: { number: number; same_segment: boolean; file: string; syllables: number }[] = [];
  for (const fileName of files) {
    const zip = await JSZip.loadAsync(await readFile(path.join(DOCX_DIR, fileName)));
    const documentXml = await zip.file("word/document.xml")?.async("string");
    if (!documentXml) continue;
    for (const q of buildImportDraft(fileName, documentXml).questions) {
      if (q.section === "listening" && q.exam === exam)
        // `syllables` is only ever used to propose an --intro mark; see plan.ts#estimateIntroEnd.
        questions.push({
          number: q.number,
          same_segment: q.same_segment,
          file: fileName,
          syllables: countHangul(q.instruction) + countHangul(q.stem.text),
        });
    }
  }
  return questions;
}

/** Every listening exam the Word files mention, with its questions — `--link-only` needs no mp3. */
async function listeningExams(): Promise<Map<string, { number: number; same_segment: boolean }[]>> {
  const exams = new Map<string, { number: number; same_segment: boolean }[]>();
  if (!existsSync(DOCX_DIR)) return exams;
  const files = (await readdir(DOCX_DIR)).filter((f) => f.toLowerCase().endsWith(".docx") && !f.startsWith("~$"));
  for (const fileName of files) {
    const zip = await JSZip.loadAsync(await readFile(path.join(DOCX_DIR, fileName)));
    const documentXml = await zip.file("word/document.xml")?.async("string");
    if (!documentXml) continue;
    for (const q of buildImportDraft(fileName, documentXml).questions) {
      if (q.section !== "listening") continue;
      exams.set(q.exam, [...(exams.get(q.exam) ?? []), { number: q.number, same_segment: q.same_segment }]);
    }
  }
  return exams;
}

/**
 * `--link-only`: attach questions to clips that already exist, and nothing else.
 *
 * Reads the Word files for the paper's shape and D1 for what is already there, plans every exam up
 * front, and writes only `topik_questions.segment_id`. An exam whose plan has any problem is
 * skipped whole — see `planLinks` for why a half-applied linking is the worst outcome available.
 */
async function runLinkOnly() {
  const fromWord = await listeningExams();
  if (fromWord.size === 0) {
    console.log(`No listening questions found in ${DOCX_DIR}.`);
    return;
  }
  const proxy = local ? await getPlatformProxy({ remoteBindings: false }) : await getPlatformProxy({ configPath: tempConfig(), remoteBindings: true });
  try {
    const db = proxy.env.DB as unknown as D1Like;
    type Planned = { exam: string; plan: LinkPlan; segments: Map<number, Segment>; segmentIdOf: Map<number, string> };
    const planned: Planned[] = [];

    for (const [exam, questions] of [...fromWord.entries()].sort()) {
      if (onlyExam && exam !== onlyExam) continue;
      const audio = await db
        .prepare("SELECT id, verified FROM topik_audio WHERE section = 'listening' AND exam = ?")
        .bind(exam)
        .first<{ id: string; verified: number }>();
      if (!audio) {
        console.log(`\n=== ${exam} ===\n  SKIPPED: no audio stored yet — run the normal --apply for this exam first.`);
        continue;
      }
      const segmentRows = (
        await db
          .prepare("SELECT id, idx, start_ms, speech_end_ms, end_ms FROM topik_segments WHERE audio_id = ? ORDER BY idx")
          .bind(audio.id)
          .all<{ id: string; idx: number; start_ms: number; speech_end_ms: number; end_ms: number }>()
      ).results;
      const existingRows = (
        await db
          .prepare("SELECT number FROM topik_questions WHERE section = 'listening' AND exam = ?")
          .bind(exam)
          .all<{ number: number }>()
      ).results;
      const linkedRows = (
        await db
          .prepare(
            `SELECT q.number AS number, s.idx AS idx FROM topik_questions q
             JOIN topik_segments s ON s.id = q.segment_id
             WHERE q.section = 'listening' AND q.exam = ?`,
          )
          .bind(exam)
          .all<{ number: number; idx: number }>()
      ).results;

      planned.push({
        exam,
        plan: planLinks({
          questions,
          segmentIdxs: segmentRows.map((r) => r.idx),
          linked: new Map(linkedRows.map((r) => [r.number, r.idx])),
          existing: new Set(existingRows.map((r) => r.number)),
        }),
        segments: new Map(segmentRows.map((r) => [r.idx, { idx: r.idx, start_ms: r.start_ms, speech_end_ms: r.speech_end_ms, end_ms: r.end_ms }])),
        segmentIdOf: new Map(segmentRows.map((r) => [r.idx, r.id])),
      });
    }

    let totalLinks = 0;
    for (const p of planned) {
      console.log(`\n=== ${p.exam} ===`);
      if (!p.plan.ok) {
        for (const r of p.plan.reasons) console.log(`  PROBLEM: ${r}`);
        console.log("  Nothing will be linked for this exam.");
        continue;
      }
      if (p.plan.notImported.length > 0) {
        // Not a problem: the Word file simply arrived before `npm run topik-import` was run.
        console.log(`  ${p.plan.notImported.length} question(s) not imported yet, so not linkable: ${p.plan.notImported.join(", ")}`);
      }
      if (p.plan.links.length === 0) {
        console.log(`  Nothing to link; ${p.plan.unusedSegments.length} clip(s) still have no question.`);
        continue;
      }
      console.log(`  ${p.plan.links.length} question(s) to link, ${p.plan.unusedSegments.length} clip(s) left for questions not typed up yet`);
      console.log("   Câu   Đoạn   Bắt đầu        Hết tiếng      Kết thúc");
      for (const link of p.plan.links) {
        const seg = p.segments.get(link.segmentIdx)!;
        console.log(
          `   ${String(link.number).padStart(3)}  →  ${String(link.segmentIdx).padStart(3)}   ` +
            `${formatMs(seg.start_ms).padStart(11)}    ${formatMs(seg.speech_end_ms).padStart(11)}    ${formatMs(seg.end_ms).padStart(11)}` +
            `${link.shared ? "   (chung đoạn)" : ""}`,
        );
      }
      totalLinks += p.plan.links.length;
    }

    const blocked = planned.filter((p) => !p.plan.ok).length;
    console.log(`\nTotal: ${totalLinks} link(s) across ${planned.length - blocked} exam(s)${blocked > 0 ? `, ${blocked} exam(s) blocked` : ""}.`);
    if (!apply) {
      console.log("\nDry run only. Check the table above, then run again with --apply --link-only.");
      return;
    }
    if (totalLinks === 0) {
      console.log("\nNothing to link.");
      return;
    }
    if (!local) backupProduction();
    for (const p of planned) {
      if (!p.plan.ok) continue;
      for (const link of p.plan.links) {
        await db
          .prepare("UPDATE topik_questions SET segment_id = ?, updated_at = ? WHERE section = 'listening' AND exam = ? AND number = ?")
          .bind(p.segmentIdOf.get(link.segmentIdx)!, Date.now(), p.exam, link.number)
          .run();
      }
    }
    // The clips themselves, their timings and their approval were never touched.
    console.log(`\nLinked ${totalLinks} question(s). No clip, no timing and no approval was changed.`);
  } finally {
    await proxy.dispose();
  }
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
  introEndMs: number;
  mergedShort: number;
  silences: Silence[];
  plan: AudioPlan;
  questions: { number: number; same_segment: boolean; file: string }[];
};

function report(p: ExamPlan) {
  console.log(`\n=== ${p.exam} — ${path.basename(p.file)} ===`);
  console.log(
    `  ${(p.fileSize / 1024 / 1024).toFixed(1)} MB, ${formatMs(p.durationMs)} long, ` +
      `${p.plan.segments.length} segment(s) found, ${p.plan.expected} expected from ${p.questions.length} question(s)`,
  );
  console.log(`  Lời dẫn mở đầu: 00:00.000 → ${formatMs(p.introEndMs)} (bỏ, không thuộc đoạn nào)`);
  // The threshold should sit in an empty band between the short in-dialogue pauses and the long
  // answer gaps; printing the bands makes a badly chosen one obvious instead of a mystery.
  const bands = silenceHistogram(p.silences)
    .filter((b) => b.count > 0)
    .map((b) => `${b.label}:${b.count}`)
    .join("  ");
  console.log(`  Khoảng lặng (ngưỡng ${silenceMs / 1000}s, ${noiseDb}dB): ${bands}`);
  if (p.mergedShort > 0) {
    console.log(
      `  Đã gộp ${p.mergedShort} đoạn chỉ có ~1 giây tiếng nói vào đoạn trước ` +
        `(lời xướng số câu thứ hai của một cặp dùng chung hội thoại; ngưỡng --min-speech ${minSpeechMs / 1000}s)`,
    );
  }
  const numbers = p.questions.map((q) => q.number).sort((a, b) => a - b);
  const assigned = new Set(p.plan.assignment.values()).size;
  console.log(
    p.questions.length === 0
      ? "  Word: chưa có câu nào cho đề này trong data/topik/"
      : `  Word phủ ${p.questions.length} câu (${numbers[0]}–${numbers.at(-1)}), đã gán ${assigned}/${p.plan.segments.length} đoạn` +
          `${p.plan.coverage === "partial" ? ` — còn ${p.plan.segments.length - assigned} đoạn chưa gán câu` : ""}`,
  );
  for (const problem of p.plan.problems) console.log(`  PROBLEM: ${problem}`);

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

/** Cuts the sample a human listens to, with the proposed mark at second `CHECK_CLIP_LEAD_S`. */
function cutCheckClip(file: string, markMs: number, exam: string): string | null {
  mkdirSync(CHECK_DIR, { recursive: true });
  const out = path.join(CHECK_DIR, `${exam.replace(/[^\w가-힣-]/g, "_")}-intro-${formatMs(markMs).replace(/[:.]/g, "")}.mp3`);
  const from = Math.max(0, markMs - CHECK_CLIP_LEAD_S * 1000) / 1000;
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(from), "-t", String(CHECK_CLIP_S), "-i", file, "-c:a", "libmp3lame", "-q:a", "4", out],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.log(`  (could not cut the sample: ${r.stderr?.trim() || r.error?.message})`);
    return null;
  }
  return out;
}

/**
 * What to print for an exam that has no `--intro` yet. Never cuts the paper, never reads D1.
 *
 * The proposal, the sample and the surrounding silences go out together on purpose: the proposal
 * alone is just a number to be believed, which is the whole failure this replaced.
 */
function reportMissingIntro(exam: string, file: string, silences: readonly Silence[], syllables: readonly number[]) {
  console.log(`\n=== ${exam} — ${path.basename(file)} ===`);
  console.log(`  THIẾU --intro: không cắt gì cả. Mốc hết lời dẫn phải do người nghe quyết định.`);
  const quiet = silences.filter((s) => s.start_ms > 500 && s.start_ms < 100_000).length;
  if (quiet === 0) {
    console.log(`  Dấu hiệu nhạc nền: 100 giây đầu KHÔNG có khoảng lặng nào ≥${DETECT_SILENCE_S}s — mọi mốc dò theo khoảng lặng đều sai ở đây.`);
  }
  const est = estimateIntroEnd(silences, silenceMs, syllables);
  if (!est.ok) {
    console.log(`  Không suy được mốc đề xuất: ${est.reason}`);
    console.log(`  Khoảng lặng ≥${DETECT_SILENCE_S}s trong 3 phút đầu (chọn một điểm "hết" làm --intro):`);
    for (const sil of silencesNear(silences, 90_000, 90_000))
      console.log(`    ${formatMs(sil.start_ms)} → ${formatMs(sil.end_ms)}  (${((sil.end_ms - sil.start_ms) / 1000).toFixed(2)}s)`);
    return;
  }
  console.log(
    `  Mốc đề xuất: ${formatMs(est.suggested_ms)}  (${(est.suggested_ms / 1000).toFixed(3)})` +
      ` — suy từ tốc độ đọc ${est.rate.toFixed(2)} âm tiết/giây của chính đề này`,
  );
  console.log(
    `  Tự kiểm: đoạn 1 sẽ dài ${(est.clip1_ms / 1000).toFixed(1)}s, văn bản câu 1 đòi ${(
      (est.speech_end1_ms - est.raw_ms) /
      1000
    ).toFixed(1)}s. Lệch nhiều là mốc sai.`,
  );
  const clip = cutCheckClip(file, est.suggested_ms, exam);
  if (clip) console.log(`  Mẩu 14 giây để nghe (mốc ở đúng giây thứ ${CHECK_CLIP_LEAD_S}): ${clip}`);
  console.log(`  Nếu nghe thấy lệch, chọn một điểm "hết" khác trong số này:`);
  for (const sil of silencesNear(silences, est.suggested_ms, CHECK_SILENCE_WINDOW_MS)) {
    const mark = sil.end_ms === est.suggested_ms ? " ← đề xuất" : "";
    console.log(
      `    ${formatMs(sil.start_ms)} → ${formatMs(sil.end_ms)}  (${((sil.end_ms - sil.start_ms) / 1000).toFixed(2)}s)` +
        `  --intro ${(sil.end_ms / 1000).toFixed(3)}${mark}`,
    );
  }
  console.log(`  Chạy lại: npm run topik-audio -- --exam ${exam} --intro ${(est.suggested_ms / 1000).toFixed(3)}${apply ? " --apply" : ""}`);
}

async function main() {
  if (linkOnly) {
    console.log(apply ? `APPLY --link-only: will write to ${local ? "the LOCAL dev database" : "production"}` : "DRY RUN --link-only: nothing is written");
    await runLinkOnly();
    return;
  }
  if (!existsSync(AUDIO_DIR)) {
    console.error(`No ${AUDIO_DIR} directory — put the exam mp3s there first.`);
    return;
  }
  const files = (await readdir(AUDIO_DIR)).filter((f) => f.toLowerCase().endsWith(".mp3"));
  if (files.length === 0) {
    console.log(`No .mp3 files in ${AUDIO_DIR}.`);
    return;
  }
  console.log(
    apply ? `APPLY${force ? " --force" : ""}: will write to ${local ? "the LOCAL dev database" : "production"}` : "DRY RUN: nothing is written",
  );

  // One `--intro` is one paper's mark. Letting it apply to every mp3 in the folder would cut seven
  // other papers at a mark measured on the eighth, and each one would look perfectly plausible.
  if (introOverride !== undefined) {
    const matched = files.filter((f) => {
      const named = examFromAudioName(f);
      return named.ok && (!onlyExam || named.exam === onlyExam);
    });
    if (matched.length > 1) {
      console.error(
        `--intro names one paper's mark, but ${matched.length} mp3(s) match: ${matched.join(", ")}.` +
          ` Add --exam <label> so the mark goes to the paper it was measured on.`,
      );
      process.exit(1);
    }
  }

  const plans: ExamPlan[] = [];
  let failedNames = 0;
  /** Exams whose mark is still missing. One `--intro` cannot serve two papers, so this stops the run. */
  let needIntro = 0;
  for (const fileName of files) {
    const named = examFromAudioName(fileName);
    if (!named.ok) {
      // Never a quiet fallback: a guessed label attaches real questions to the wrong exam, and
      // nothing looks broken until much later.
      console.log(`\n=== ${fileName} ===\n  PROBLEM: ${named.reason}`);
      failedNames += 1;
      continue;
    }
    const exam = named.exam;
    if (onlyExam && exam !== onlyExam) continue;

    const file = path.join(AUDIO_DIR, fileName);
    const durationMs = ffprobeDurationMs(file);
    const silences = parseSilenceLog(ffmpegSilenceLog(file), durationMs);
    const questionsForIntro = await listeningQuestions(exam);
    if (introOverride === undefined) {
      // No guessing, not even a dry run: a proposed cut is what people act on.
      reportMissingIntro(
        exam,
        file,
        silences,
        [1, 2, 3].map((n) => questionsForIntro.find((q) => q.number === n)?.syllables ?? 0),
      );
      needIntro += 1;
      continue;
    }
    const introEnd = introOverride;
    const detected = buildSegments(boundarySilences(silences, silenceMs), durationMs, introEnd);
    const { segments, merged } = mergeShortSegments(detected, minSpeechMs);
    const questions = questionsForIntro;
    plans.push({
      exam,
      file,
      fileSize: statSync(file).size,
      durationMs,
      introEndMs: introEnd,
      mergedShort: merged,
      silences,
      plan: planAudio(segments, questions, durationMs),
      questions,
    });
  }

  if (needIntro > 0) {
    console.error(
      `\n${needIntro} exam(s) have no --intro. Nothing was read from D1 and nothing was written.` +
        ` Listen to the sample(s) above, then run one exam at a time with --exam … --intro ….`,
    );
    process.exit(1);
  }
  for (const p of plans) report(p);
  const clean = plans.filter((p) => p.plan.problems.length === 0 && p.plan.coverage !== "none");
  const partial = clean.filter((p) => p.plan.coverage === "partial").length;
  console.log(
    `\nTotal: ${plans.length} exam(s), ${clean.length} ready (${partial} of them covering only the start of the paper)` +
      `${failedNames > 0 ? `, ${failedNames} file(s) skipped because their name could not be read` : ""}.`,
  );
  console.log("Every exam is stored UNVERIFIED; approve it in Settings → TOPIK before practice uses it.");
  if (!apply) {
    console.log("\nDry run only. Check the report above, then run again with --apply.");
    return;
  }

  // Local runs touch only .wrangler/state, which `npm run dev` serves and no one else shares.
  if (!local) backupProduction();
  const proxy = local
    ? await getPlatformProxy({ remoteBindings: false })
    : await getPlatformProxy({ configPath: tempConfig(), remoteBindings: true });
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
