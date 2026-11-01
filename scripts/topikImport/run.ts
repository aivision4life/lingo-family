// One-off (M6.1): imports TOPIK reading questions from .docx files in data/topik/ (gitignored,
// copyrighted exam material) into production.
//
//   npm run topik-import                                         dry run (default): parses every file, prints a report
//   npm run topik-import -- --apply                               backs up production D1, then inserts
//   npm run topik-import -- --apply --local                       writes to the local dev D1/R2 instead (try a file out)
//   npm run topik-import -- --apply --force                       also overwrites a question that was already edited/verified
//   npm run topik-import -- --apply --force --keep-verified       same, but keeps the row's existing `verified` (see below)
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
// Safety net (M6.5-ish): before writing anything, if `--force` would overwrite an existing stem
// that had no `<u>…</u>` yet with a new one that does, the new stem with its tags stripped back out
// MUST be byte-identical to the existing one — a touch-up that's "only adding formatting" must
// never also silently drop or alter a character. A mismatch aborts the whole run before any write
// (not just skips the offending row), prints every mismatch found, and does not even take a backup.
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
import { stripUnderline, type TopikOptions } from "../../shared/topik";
import { imageInfo } from "../../worker/lib/imageInfo";
import { buildImportDraft, type DraftQuestion } from "../../worker/services/topikImport";
import { checkImageBytes, checkQuestionImages, imageRefsOf, verifiedAfterOverwrite, type MediaByRid } from "./plan";

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
  const info = imageInfo(bytes);
  const key = `images/upload/${hex(await crypto.subtle.digest("SHA-1", bytes.buffer as ArrayBuffer))}.${info.ext}`;
  if (!(await bucket.head(key))) await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  return { key };
}

const PROD_DB_NAME = "lingo-family";
const PROD_MEDIA_BUCKET = "lingo-family-media";
const DATA_DIR = "data/topik";

const args = process.argv.slice(3);
const apply = args.includes("--apply");
const force = args.includes("--force");
const keepVerified = args.includes("--keep-verified");
/** Write to the dev server's own D1/R2 (.wrangler/state) instead of production, to try a file out. */
const local = args.includes("--local");

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

/** Resolves one `image_rid` (a docx relationship id) to a stored R2 key. Only called after
 * `checkQuestionImages` has already verified the rid resolves and passes validation, so a null
 * here would mean that guarantee was somehow broken — the caller treats it as a bug, not silence. */
async function resolveImage(bucket: R2Like, rid: string | null, mediaByRid: ParsedFile["mediaByRid"]): Promise<string | null> {
  if (!rid) return null;
  const media = mediaByRid.get(rid);
  if (!media) return null;
  const stored = await storeImage(bucket, media.bytes, media.contentType);
  return stored?.key ?? null;
}

async function resolveOptions(bucket: R2Like, q: DraftQuestion, mediaByRid: MediaByRid): Promise<TopikOptions> {
  const options = await Promise.all(
    q.options.map(async (o) => ({ text: o.text, image_key: await resolveImage(bucket, o.image_rid, mediaByRid) })),
  );
  return options as TopikOptions;
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.error(`No ${DATA_DIR} directory — nothing to import.`);
    return;
  }
  // "~$name.docx" is Word's own lock file for a document that is currently open — it is not a zip
  // at all, so including it crashed the whole run with an opaque JSZip "is this a zip file?" error
  // just because the file happened to be open while importing.
  const fileNames = (await readdir(DATA_DIR)).filter((f) => f.toLowerCase().endsWith(".docx") && !f.startsWith("~$"));
  if (fileNames.length === 0) {
    console.log(`No .docx files in ${DATA_DIR}.`);
    return;
  }
  console.log(
    apply
      ? `APPLY${force ? " --force" : ""}${keepVerified ? " --keep-verified" : ""}: will write to ${local ? "the LOCAL dev database" : "production"}`
      : "DRY RUN: nothing is written",
  );

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
  console.log(`\nTotal: ${totalOk} question(s) ready to import, ${totalErrors} error(s) (not imported).`);
  console.log(`${totalWithImage} question(s) have at least one image (${totalImageRefs} image reference(s) will be uploaded to R2).`);

  if (!apply) {
    console.log("\nDry run only. Check the report above, then run again with --apply.");
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

    if (force) {
      const problems: string[] = [];
      for (const f of parsed) {
        for (const q of f.questions) {
          const existing = await db
            .prepare("SELECT stem_text FROM topik_questions WHERE section = ?1 AND exam = ?2 AND number = ?3")
            .bind(q.section, q.exam, q.number)
            .first<{ stem_text: string | null }>();
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
      }
      if (problems.length > 0) {
        console.error(`\n--force aborted before writing anything: ${problems.length} question(s) would change their plain reading, not just add <u> formatting:\n`);
        for (const p of problems) console.error(`  ${p}`);
        return;
      }
    }

    if (!local) backupProduction();

    let inserted = 0;
    let skipped = 0;
    let overwritten = 0;
    for (const f of parsed) {
      for (const q of f.questions) {
        const existing = await db
          .prepare("SELECT id, verified FROM topik_questions WHERE section = ?1 AND exam = ?2 AND number = ?3")
          .bind(q.section, q.exam, q.number)
          .first<{ id: string; verified: number }>();
        if (existing && !force) {
          skipped++;
          continue;
        }
        const options = await resolveOptions(bucket, q, f.mediaByRid);
        const stemImageKey = await resolveImage(bucket, q.stem.image_rid, f.mediaByRid);
        // checkQuestionImages() already verified every image reference resolves and validates;
        // a null key here would mean that guarantee broke between the check and now — stop loudly
        // instead of silently writing the row without its image.
        if (q.stem.image_rid && !stemImageKey) throw new Error(`${q.exam} #${q.number}: stem image unexpectedly failed to upload`);
        const missingOption = options.findIndex((o, i) => q.options[i]!.image_rid && !o.image_key);
        if (missingOption !== -1) throw new Error(`${q.exam} #${q.number}: option ${missingOption + 1} image unexpectedly failed to upload`);
        const optionsJson = JSON.stringify(options);

        if (existing) {
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
    }
    console.log(`\nInserted ${inserted}, skipped ${skipped} (already existed, not --force)${force ? `, overwrote ${overwritten}` : ""}.`);
    console.log('All imported rows are unverified — review them in Settings → TOPIK before they appear in practice.');
  } finally {
    await proxy.dispose();
  }
}

await main();
