// One-off (M6.1): imports TOPIK reading questions from .docx files in data/topik/ (gitignored,
// copyrighted exam material) into production.
//
//   npm run topik-import                                         dry run (default): parses every file, prints a report
//   npm run topik-import -- --apply                               backs up production D1, then inserts
//   npm run topik-import -- --apply --local                       writes to the local dev D1/R2 instead (try a file out)
//   npm run topik-import -- --apply --force                       also overwrites a question that was already edited/verified
//   npm run topik-import -- --apply --force --keep-verified       same, but keeps the row's existing `verified` (see below)
//   npm run topik-import -- --diff                                read-only: what --force WOULD change, column by column
//   npm run topik-import -- --section listening                   only the listening files; --section reading for the others
//   npm run topik-import -- --source Yonsei                       only files whose name's <source> is Yonsei
//   npm run topik-import -- --file Test35                         only files whose name contains "Test35"
//
// `--section` / `--source` filter by **file name** and apply identically to the dry run and to
// `--apply`, so the printed report always describes exactly the set that would be written. Because
// `--force` UPDATEs every existing question it parsed, `--force` with no `--section` is refused
// before the backup and before any write: it names how many existing questions each section would
// lose its `verified` flag on, and asks for either `--section` or an explicit `--all-sections`.
// Without this guard, re-importing one re-cut listening file would also quietly un-approve every
// reviewed reading question in data/topik/.
//
// A question with a parse error (mismatched or malformed answer, wrong option count) is never
// imported. A question that already exists (same section+exam+number) is skipped unless --force,
// which UPDATEs it in place (same id — any `topik_cards`/`topik_attempts` row pointing at it, and
// its `vocab`/`explanation_vi` columns, are untouched: the UPDATE statement never names them) and,
// by default, resets `verified` to false since the content changed and should be looked at again.
// `--keep-verified` skips that reset — for a touch-up re-import that does not actually change the
// question's meaning (e.g. a parser fix that only adds line breaks or `<u>…</u>` underline
// markers). Imported (newly inserted) questions always start unverified; review and approve them in
// Settings → TOPIK before they are used for practice (GET /api/topik/session only returns verified
// questions).
//
// **Before every `--apply --force`, run `--diff` and read the table** (SPEC §11, M7.15). It parses
// the same files under the same filter, reads the rows that would be overwritten, and prints only
// the questions whose columns actually differ — with each one's `verified`/vocab/explanation state,
// since those decide which rows need their AI content regenerating afterwards. It writes nothing,
// takes no backup, and is the only thing that will tell you an overwrite is about to change more
// than you meant: the stem guard below is far narrower than it sounds.
//
// Safety net (M6.5-ish), and mind how narrow it is: before writing anything, if `--force` would
// overwrite an existing stem
// that had no `<u>…</u>` yet with a new one that does, the new stem with its tags stripped back out
// MUST be byte-identical to the existing one — a touch-up that's "only adding formatting" must
// never also silently drop or alter a character. A mismatch aborts the whole run before any write
// (not just skips the offending row), prints every mismatch found, and does not even take a backup.
// It checks **nothing else**: a stem rewritten with no `<u>` on either side (an ordinary content
// correction, or a parser regression) passes straight through. It is a guard on one manoeuvre, not
// on meaning — which is why `--diff` exists and why the SPEC makes it a required step.
//
// Needs `npx wrangler login`. Reaches production through wrangler "remote bindings" (a temporary
// config; nothing in wrangler.jsonc changes), same as scripts/assignCreator.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { getPlatformProxy } from "wrangler";
import type { TopikSection } from "../../shared/enums";
import { stripUnderline, type TopikOptions } from "../../shared/topik";
import { imageInfo } from "../../worker/lib/imageInfo";
import { buildImportDraft, parseTopikFileName, type DraftQuestion } from "../../worker/services/topikImport";
import {
  changedLines,
  checkImageBytes,
  checkQuestionImages,
  diffColumns,
  examCoverage,
  fileMatchesFilter,
  filterLabel,
  forceScopeProblem,
  imageRefsOf,
  parseSectionFlag,
  refreshAiSql,
  shortBlocks,
  shortGroups,
  verifiedAfterOverwrite,
  type DiffRow,
  type ImportFilter,
  type MediaByRid,
  type QuestionSnapshot,
} from "./plan";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> };
type D1Like = { prepare(sql: string): Stmt };
// A structural (not the ambient `R2Bucket`) type: scripts/ compiles without Workers types
// (tsconfig.node.json), same reason worker/lib/quota.ts-style D1 helpers aren't imported here either.
type R2Like = { head(key: string): Promise<unknown>; put(key: string, body: Uint8Array, opts: unknown): Promise<unknown> };

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Local copy of `worker/services/imageUpload.ts#storeUploadedImage`, typed against `R2Like`
 * instead of the ambient `R2Bucket` (scripts/ has no Workers types) — same validation/key scheme.
 * Only called on `--apply`, after `checkImageBytes` has already passed for every image used. */
async function storeImage(bucket: R2Like, bytes: Uint8Array, contentType: string): Promise<{ key: string } | null> {
  const check = checkImageBytes(bytes, contentType);
  if (!check.ok) return null;
  const type = contentType.split(";")[0]!.trim();
  const key = await imageKeyFor(bytes);
  if (!(await bucket.head(key))) await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  return { key };
}

/** The content-addressed key those bytes would get. Pure arithmetic over the bytes, so `--diff`
 * can compare image columns exactly without uploading anything. */
async function imageKeyFor(bytes: Uint8Array): Promise<string> {
  const info = imageInfo(bytes);
  return `images/upload/${hex(await crypto.subtle.digest("SHA-1", bytes.buffer as ArrayBuffer))}.${info.ext}`;
}

const PROD_DB_NAME = "lingo-family";
const PROD_MEDIA_BUCKET = "lingo-family-media";
const DATA_DIR = "data/topik";

const args = process.argv.slice(3);
const apply = args.includes("--apply");
const force = args.includes("--force");
const keepVerified = args.includes("--keep-verified");
/** Read-only: print what `--force` would change, and stop. Never writes, never backs up. */
const diffOnly = args.includes("--diff");
/** Write to the dev server's own D1/R2 (.wrangler/state) instead of production, to try a file out. */
const local = args.includes("--local");
/** Confirms that a `--force` run really is meant to overwrite questions in every section. */
const allSections = args.includes("--all-sections");

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const sectionFlag = parseSectionFlag(flag("--section"));
if (!sectionFlag.ok) {
  console.error(sectionFlag.reason);
  process.exit(1);
}
const filter: ImportFilter = { section: sectionFlag.section, source: flag("--source") ?? null, name: flag("--file") ?? null };

function tempConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-topik-import-"));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "lingo-topik-import",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: "10da2bc0-1ba1-4ae2-80be-df43cd5b1931", remote: true }],
      r2_buckets: [{ binding: "MEDIA", bucket_name: PROD_MEDIA_BUCKET, remote: true }],
    }),
  );
  return file;
}

function backupProduction() {
  mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `prod-d1-pre-topik-import-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
  const r = spawnSync("npx", ["wrangler", "d1", "export", PROD_DB_NAME, "--remote", "--output", file], { stdio: "inherit", shell: true });
  if (r.status !== 0 || !existsSync(file) || statSync(file).size === 0) throw new Error("Production backup failed; nothing was changed.");
  console.log(`\nProduction D1 backed up to ${file} (${statSync(file).size} bytes)`);
}

const MEDIA_CONTENT_TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

/** One parsed source file: its drafts plus everything needed to resolve `image_rid`s to bytes. */
type ParsedFile = {
  fileName: string;
  questions: DraftQuestion[];
  errors: string[];
  warnings: string[];
  /** rId → media bytes + content type, for `--apply` only. */
  mediaByRid: MediaByRid;
};

/** The production/local row a draft would replace, as read once before any write. */
type ExistingRow = {
  id: string;
  verified: number;
  block: string | null;
  instruction: string | null;
  stem_text: string | null;
  stem_image_key: string | null;
  options: string;
  correct_option: number;
  warning: string | null;
  /** Whether the AI columns have ever been filled — what decides if an overwrite leaves them stale. */
  vocab_done: number;
  explain_done: number;
};

const EXISTING_COLUMNS =
  "id, verified, block, instruction, stem_text, stem_image_key, options, correct_option, warning, " +
  "(vocab_checked_at IS NOT NULL) AS vocab_done, (explain_checked_at IS NOT NULL) AS explain_done";
/** One draft question paired with the row it matches (null = it will be inserted). */
type ImportRow = { f: ParsedFile; q: DraftQuestion; existing: ExistingRow | null };

async function parseFile(filePath: string, fileName: string): Promise<ParsedFile> {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const draft = buildImportDraft(fileName, documentXml);

  const mediaByRid: MediaByRid = new Map();
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (relsFile) {
    const relsXml = await relsFile.async("string");
    for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="(media\/[^"]+)"/g)) {
      const [, rid, target] = m as unknown as [string, string, string];
      const ext = target.split(".").pop()!.toLowerCase();
      const contentType = MEDIA_CONTENT_TYPE[ext];
      // `target` ("media/imageN.png") is relative to word/ — not the zip root (M6.1 fix: this
      // prefix was missing, so every image silently failed to resolve and no image was ever
      // uploaded, even for questions correctly parsed as having one).
      const file = zip.file(`word/${target}`);
      if (!contentType || !file) continue;
      mediaByRid.set(rid, { bytes: new Uint8Array(await file.async("arraybuffer")), contentType });
    }
  }
  return { fileName, questions: draft.questions, errors: draft.errors, warnings: draft.warnings, mediaByRid };
}

/**
 * How an image reference becomes a key. Two of them: the write path uploads the bytes, and
 * `--diff` only hashes them — the key is content-addressed, so the comparison is exact without
 * putting anything in R2.
 */
type KeyResolver = (media: { bytes: Uint8Array; contentType: string }) => Promise<string | null>;

const uploadKeys = (bucket: R2Like): KeyResolver => async (media) => (await storeImage(bucket, media.bytes, media.contentType))?.key ?? null;
const hashKeys: KeyResolver = async (media) => (checkImageBytes(media.bytes, media.contentType).ok ? imageKeyFor(media.bytes) : null);

/** Resolves one `image_rid` (a docx relationship id) to its R2 key. Only called after
 * `checkQuestionImages` has already verified the rid resolves and passes validation, so a null
 * here would mean that guarantee was somehow broken — the caller treats it as a bug, not silence. */
async function resolveImage(keys: KeyResolver, rid: string | null, mediaByRid: ParsedFile["mediaByRid"]): Promise<string | null> {
  if (!rid) return null;
  const media = mediaByRid.get(rid);
  if (!media) return null;
  return keys(media);
}

async function resolveOptions(keys: KeyResolver, q: DraftQuestion, mediaByRid: MediaByRid): Promise<TopikOptions> {
  const options = await Promise.all(
    q.options.map(async (o) => ({ text: o.text, image_key: await resolveImage(keys, o.image_rid, mediaByRid) })),
  );
  return options as TopikOptions;
}

/** A parsed question in the shape the nine written columns have, ready to compare or to write. */
async function snapshotOf(keys: KeyResolver, q: DraftQuestion, mediaByRid: MediaByRid): Promise<QuestionSnapshot> {
  return {
    block: q.block,
    instruction: q.instruction,
    stem_text: q.stem.text,
    stem_image_key: await resolveImage(keys, q.stem.image_rid, mediaByRid),
    options: JSON.stringify(await resolveOptions(keys, q, mediaByRid)),
    correct_option: q.correct_option,
    warning: q.warning,
  };
}

const existingSnapshot = (row: ExistingRow): QuestionSnapshot => ({
  block: row.block,
  instruction: row.instruction,
  stem_text: row.stem_text,
  stem_image_key: row.stem_image_key,
  options: row.options,
  correct_option: row.correct_option,
  warning: row.warning,
});

const tick = (on: boolean) => (on ? "có" : "chưa");

/** Prints one changed column: only the lines that moved, when the two sides line up. */
function printColumn(column: string, before: string | null, after: string | null) {
  const lines = changedLines(before, after);
  if (lines === null) {
    console.log(`    ${column}:`);
    console.log(`      - ${JSON.stringify(before)}`);
    console.log(`      + ${JSON.stringify(after)}`);
    return;
  }
  console.log(`    ${column} (${lines.length} dòng đổi):`);
  for (const l of lines) {
    console.log(`      dòng ${l.line}`);
    console.log(`        - ${l.before}`);
    console.log(`        + ${l.after}`);
  }
}

/** The whole comparison table: only the questions that would change, and what they would lose. */
function printDiff(rows: readonly DiffRow[], total: number) {
  const changed = rows.filter((r) => r.diffs.length > 0);
  console.log(`\n=== Đối chiếu với bản đang chạy (${changed.length}/${total} câu sẽ đổi) ===`);
  if (changed.length === 0) {
    console.log("  (không câu nào đổi — --force sẽ ghi lại y nguyên nội dung hiện có)");
    return;
  }
  for (const r of changed) {
    console.log(`\n  ${r.exam} #${r.number}  [đã duyệt: ${tick(r.verified)} · vocab: ${tick(r.has_vocab)} · giải thích: ${tick(r.has_explain)}]`);
    for (const d of r.diffs) printColumn(d.column, d.before, d.after);
  }

  const byColumn = new Map<string, number>();
  for (const r of changed) for (const d of r.diffs) byColumn.set(d.column, (byColumn.get(d.column) ?? 0) + 1);
  console.log(`\n  Không đổi: ${total - changed.length} câu.`);
  console.log(`  Cột bị đụng: ${[...byColumn].map(([c, n]) => `${c} (${n})`).join(", ")}`);
}

/**
 * The statement that makes the stale rows generate their AI content again — printed for the owner
 * to run, never run here. Nothing else will do it: both triggers require a null timestamp.
 */
function printAiRefresh(rows: readonly DiffRow[]) {
  const sql = refreshAiSql(rows);
  console.log("\n=== Sinh lại vocab/giải thích ===");
  if (!sql) {
    console.log("  (không cần — không câu nào vừa đổi nội dung vừa đã có dữ liệu AI)");
    return;
  }
  console.log("  Dữ liệu AI cũ KHÔNG tự sinh lại: cả phiên luyện lẫn nút \"Tạo dữ liệu AI\" chỉ chạy khi dấu");
  console.log("  thời gian còn trống. Chạy câu này rồi mở lại phiên (hoặc bấm nút) là nó sinh mới:\n");
  for (const line of sql.split("\n")) console.log(`  ${line}`);
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.error(`No ${DATA_DIR} directory — nothing to import.`);
    return;
  }
  // "~$name.docx" is Word's own lock file for a document that is currently open — it is not a zip
  // at all, so including it crashed the whole run with an opaque JSZip "is this a zip file?" error
  // just because the file happened to be open while importing.
  const allFiles = (await readdir(DATA_DIR)).filter((f) => f.toLowerCase().endsWith(".docx") && !f.startsWith("~$"));
  if (allFiles.length === 0) {
    console.log(`No .docx files in ${DATA_DIR}.`);
    return;
  }
  // The same file-name filter decides the dry run and the apply, so the report always describes
  // exactly the set that would be written.
  const fileNames = allFiles.filter((f) => fileMatchesFilter(f, filter));
  if (fileNames.length === 0) {
    console.log(`No .docx file in ${DATA_DIR} matches ${filterLabel(filter)} (${allFiles.length} file(s) skipped).`);
    return;
  }
  console.log(
    diffOnly
      ? `DIFF (read-only): comparing against ${local ? "the LOCAL dev database" : "production"}; nothing is written`
      : apply
        ? `APPLY${force ? " --force" : ""}${keepVerified ? " --keep-verified" : ""}: will write to ${local ? "the LOCAL dev database" : "production"}`
        : "DRY RUN: nothing is written",
  );
  console.log(`Scope: ${filterLabel(filter)} — ${fileNames.length} of ${allFiles.length} file(s) in ${DATA_DIR}`);
  if (force && filter.section === null && !allSections) {
    console.log("NOTE: --force with no --section; an apply will be blocked unless you add --section or --all-sections.");
  }

  const parsed: ParsedFile[] = [];
  for (const fileName of fileNames) {
    const f = await parseFile(path.join(DATA_DIR, fileName), fileName);
    // Checked here (not just on --apply) so a missing/invalid image is a reported error in the
    // dry run too, and that question is excluded rather than silently imported without its image.
    const kept: DraftQuestion[] = [];
    for (const q of f.questions) {
      const imgErrors = checkQuestionImages(q, f.mediaByRid);
      if (imgErrors.length > 0) f.errors.push(`${q.exam} #${q.number}: ${imgErrors.join("; ")}`);
      else kept.push(q);
    }
    f.questions = kept;
    parsed.push(f);
  }

  let totalOk = 0;
  let totalErrors = 0;
  let totalWithImage = 0;
  let totalImageRefs = 0;
  for (const f of parsed) {
    const withImage = f.questions.filter((q) => imageRefsOf(q).length > 0);
    console.log(`\n=== ${f.fileName} ===`);
    console.log(
      `  ${f.questions.length} question(s) parsed, ${f.errors.length} error(s), ${f.warnings.length} warning(s), ` +
        `${withImage.length} with image(s) (${withImage.reduce((n, q) => n + imageRefsOf(q).length, 0)} image reference(s))`,
    );
    for (const w of f.warnings) console.log(`  WARN: ${w}`);
    for (const e of f.errors) console.log(`  ERROR: ${e}`);
    totalOk += f.questions.length;
    totalErrors += f.errors.length;
    totalWithImage += withImage.length;
    totalImageRefs += withImage.reduce((n, q) => n + imageRefsOf(q).length, 0);
  }
  console.log(`\nTotal (${filterLabel(filter)}): ${totalOk} question(s) ready to import, ${totalErrors} error(s) (not imported).`);
  console.log(`${totalWithImage} question(s) have at least one image (${totalImageRefs} image reference(s) will be uploaded to R2).`);

  // M7.8: what parses cleanly can still be half a paper. Gathered after every file, because one
  // exam's questions are spread over several of them.
  const holes = parsed.flatMap((f) => {
    const fn = parseTopikFileName(f.fileName);
    if (!fn) return [];
    // A block file states its intent in its name; a whole paper states it per question, in the
    // "[N~M]" line each one carries (M7.16).
    return fn.kind === "paper"
      ? shortBlocks(f.questions).map((g) => ({ file: f.fileName, where: `${g.exam} khối ${g.block}`, ...g }))
      : shortGroups(f.questions, fn.start, fn.end).map((g) => ({ file: f.fileName, where: `nhóm ${g.exam}`, ...g }));
  });
  console.log(`\n=== Nhóm thiếu câu (${holes.length}) ===`);
  if (holes.length === 0) console.log("  (không có — mọi nhóm đủ số câu mà dải của nó đòi)");
  for (const h of holes) {
    console.log(`  ${h.file} — ${h.where}: có ${h.have} câu, dải đòi ${h.want}; thiếu câu ${h.missing.join(", ")}`);
  }

  // Per exam, across every file of this run: how much of it a mock test of the original paper can
  // use, which is the numbering running unbroken from 1 (`isContiguousFromOne`).
  const coverage = examCoverage(parsed.flatMap((f) => f.questions));
  console.log(`\n=== Độ phủ theo đề (${coverage.length}) ===`);
  console.log("  đề                       có    mini test dùng được (chạy liền từ 1)");
  for (const c of coverage) {
    const note = c.usable < c.count ? `   ← hổng sau câu ${c.usable}` : "";
    console.log(`  ${c.exam.padEnd(24)} ${String(c.count).padStart(3)}    ${String(c.usable).padStart(3)}${note}`);
  }

  if (!apply && !diffOnly) {
    console.log("\nDry run only. Check the report above, then run again with --diff to compare, then --apply.");
    return;
  }
  if (totalOk === 0) {
    console.log("\nNothing to import.");
    return;
  }

  // Local runs touch only .wrangler/state, which `npm run dev` serves and no one else shares.
  const proxy = local
    ? await getPlatformProxy({ remoteBindings: false })
    : await getPlatformProxy({ configPath: tempConfig(), remoteBindings: true });
  try {
    const db = proxy.env.DB as unknown as D1Like;
    const bucket = proxy.env.MEDIA as unknown as R2Like;

    // One read-only pass first: which drafts already exist. It feeds the --force scope guard (which
    // must run before the backup and before any write) and is then reused by both the stem safety
    // net and the write loop, instead of looking the same rows up three times.
    const rows: ImportRow[] = [];
    for (const f of parsed) {
      for (const q of f.questions) {
        const existing = await db
          .prepare(`SELECT ${EXISTING_COLUMNS} FROM topik_questions WHERE section = ?1 AND exam = ?2 AND number = ?3`)
          .bind(q.section, q.exam, q.number)
          .first<ExistingRow>();
        rows.push({ f, q, existing });
      }
    }

    // --diff stops here: it has everything it needs, and it is the one mode that must be provably
    // incapable of writing — no scope guard to pass, no backup, no UPDATE below it.
    if (diffOnly) {
      const diffRows: DiffRow[] = [];
      let missing = 0;
      for (const { f, q, existing } of rows) {
        if (!existing) {
          missing++;
          continue;
        }
        const after = await snapshotOf(hashKeys, q, f.mediaByRid);
        diffRows.push({
          id: existing.id,
          exam: q.exam,
          number: q.number,
          verified: existing.verified === 1,
          has_vocab: existing.vocab_done === 1,
          has_explain: existing.explain_done === 1,
          diffs: diffColumns(existingSnapshot(existing), after),
        });
      }
      // A listening question with no approved recording is invisible everywhere (the practice
      // picker and the test picker both require a clip + an approved exam audio), so importing one
      // is harmless — but silent. Say it out loud, per exam, so the owner can decide to wait.
      const examsHere = [...new Set(parsed.flatMap((f) => f.questions.map((q) => `${q.section} ${q.exam}`)))];
      const audioNotes: string[] = [];
      for (const key of examsHere) {
        const [section, exam] = key.split(" ") as [string, string];
        if (section !== "listening") continue;
        const audio = await db
          .prepare("SELECT verified FROM topik_audio WHERE section = ?1 AND exam = ?2")
          .bind(section, exam)
          .first<{ verified: number }>();
        const count = parsed.flatMap((f) => f.questions).filter((q) => q.exam === exam).length;
        if (!audio) audioNotes.push(`${exam}: ${count} câu — CHƯA CÓ BĂNG (sẽ không hiện ở luyện tập lẫn thi thử)`);
        else if (audio.verified !== 1) audioNotes.push(`${exam}: ${count} câu — có băng nhưng CHƯA DUYỆT ranh giới`);
      }

      printDiff(diffRows, diffRows.length);
      console.log(`
=== Băng nghe (${audioNotes.length} đề cần chú ý) ===`);
      if (audioNotes.length === 0) console.log("  (mọi đề nghe trong lần chạy này đều đã có băng đã duyệt)");
      for (const n of audioNotes) console.log(`  ${n}`);
      if (missing > 0) console.log(`\n  (${missing} câu trong file chưa có trong cơ sở dữ liệu — --apply sẽ CHÈN MỚI, không nằm trong bảng trên)`);
      printAiRefresh(diffRows);
      console.log("\nKhông ghi gì cả. Xác nhận bảng trên rồi mới chạy --apply --force.");
      return;
    }

    const existingBySection: Partial<Record<TopikSection, number>> = {};
    for (const r of rows) {
      if (r.existing) existingBySection[r.q.section] = (existingBySection[r.q.section] ?? 0) + 1;
    }
    const scopeProblem = forceScopeProblem({ force, section: filter.section, allSections, existingBySection });
    if (scopeProblem) {
      console.error(`\nNothing was written.\n${scopeProblem}`);
      return;
    }

    if (force) {
      const problems: string[] = [];
      for (const { q, existing } of rows) {
        if (!existing) continue;
        const newHasUnderline = q.stem.text?.includes("<u>") ?? false;
        const oldHasUnderline = existing.stem_text?.includes("<u>") ?? false;
        if (!newHasUnderline || oldHasUnderline) continue; // not "adding formatting" for the first time
        const stripped = q.stem.text ? stripUnderline(q.stem.text) : null;
        if (stripped !== existing.stem_text) {
          problems.push(
            `${q.exam} #${q.number}:\n    production stem_text: ${JSON.stringify(existing.stem_text)}\n    new, <u> stripped    : ${JSON.stringify(stripped)}`,
          );
        }
      }
      if (problems.length > 0) {
        console.error(`\n--force aborted before writing anything: ${problems.length} question(s) would change their plain reading, not just add <u> formatting:\n`);
        for (const p of problems) console.error(`  ${p}`);
        return;
      }
    }

    if (!local) backupProduction();

    const keys = uploadKeys(bucket);
    /** What the overwrites actually changed, so the run can end by naming the stale AI rows. */
    const written: DiffRow[] = [];
    let inserted = 0;
    let skipped = 0;
    let overwritten = 0;
    for (const { f, q, existing } of rows) {
      if (existing && !force) {
        skipped++;
        continue;
      }
      const options = await resolveOptions(keys, q, f.mediaByRid);
      const stemImageKey = await resolveImage(keys, q.stem.image_rid, f.mediaByRid);
      // checkQuestionImages() already verified every image reference resolves and validates;
      // a null key here would mean that guarantee broke between the check and now — stop loudly
      // instead of silently writing the row without its image.
      if (q.stem.image_rid && !stemImageKey) throw new Error(`${q.exam} #${q.number}: stem image unexpectedly failed to upload`);
      const missingOption = options.findIndex((o, i) => q.options[i]!.image_rid && !o.image_key);
      if (missingOption !== -1) throw new Error(`${q.exam} #${q.number}: option ${missingOption + 1} image unexpectedly failed to upload`);
      const optionsJson = JSON.stringify(options);

      if (existing) {
        written.push({
          id: existing.id,
          exam: q.exam,
          number: q.number,
          verified: existing.verified === 1,
          has_vocab: existing.vocab_done === 1,
          has_explain: existing.explain_done === 1,
          diffs: diffColumns(existingSnapshot(existing), {
            block: q.block,
            instruction: q.instruction,
            stem_text: q.stem.text,
            stem_image_key: stemImageKey,
            options: optionsJson,
            correct_option: q.correct_option,
            warning: q.warning,
          }),
        });
        const verified = verifiedAfterOverwrite(existing.verified === 1, keepVerified);
        await db
          .prepare(
            `UPDATE topik_questions SET block=?1, instruction=?2, stem_text=?3, stem_image_key=?4, options=?5, correct_option=?6, warning=?7, verified=?8, updated_at=?9 WHERE id=?10`,
          )
          .bind(q.block, q.instruction, q.stem.text, stemImageKey, optionsJson, q.correct_option, q.warning, verified ? 1 : 0, Date.now(), existing.id)
          .run();
        overwritten++;
      } else {
        await db
          .prepare(
            `INSERT INTO topik_questions (id, section, exam, number, block, instruction, stem_text, stem_image_key, options, correct_option, warning, verified, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?12)`,
          )
          .bind(crypto.randomUUID(), q.section, q.exam, q.number, q.block, q.instruction, q.stem.text, stemImageKey, optionsJson, q.correct_option, q.warning, Date.now())
          .run();
        inserted++;
      }
    }
    console.log(`\nInserted ${inserted}, skipped ${skipped} (already existed, not --force)${force ? `, overwrote ${overwritten}` : ""}.`);
    console.log('All imported rows are unverified — review them in Settings → TOPIK before they appear in practice.');
    // An overwrite leaves the AI columns alone, which means it leaves them *stale*: the owner is
    // told exactly which rows, and handed the statement, rather than finding out in a session.
    if (written.length > 0) printAiRefresh(written);
  } finally {
    await proxy.dispose();
  }
}

await main();
