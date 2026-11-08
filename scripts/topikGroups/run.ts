// One-off (M7.21): fills `topik_questions.group_key` for questions that were imported before the
// column existed, from what the Word files in data/topik/ already say (`CHUNG ĐOẠN`).
//
//   npm run topik-groups                  dry run (default): prints every change it would make
//   npm run topik-groups -- --apply       backs up production D1, then writes
//   npm run topik-groups -- --apply --local   writes to the local dev D1 instead (.wrangler/state)
//   npm run topik-groups -- --section reading     only this section
//
// **Writes that one column only.** The UPDATE names `group_key` and nothing else — not
// `stem_text`, not `verified`, not `updated_at` — so a reviewed question stays reviewed and a
// hand-corrected text stays as it was. This is why it exists instead of re-running the importer
// with `--force`, which rewrites eight columns and (without `--keep-verified`) un-approves
// everything it touches.
//
// Idempotent: the plan is "rows whose key disagrees with the files", so a second run reports 0
// changes. A row no Word file covers is reported as an orphan and left alone — never cleared.
//
// Needs `npx wrangler login`. Reaches production through wrangler "remote bindings" (a temporary
// config; nothing in wrangler.jsonc changes), same as scripts/topikImport.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { getPlatformProxy } from "wrangler";
import { TOPIK_SECTIONS, type TopikSection } from "../../shared/enums";
import { buildImportDraft } from "../../worker/services/topikImport";
import { groupSummary, planBackfill, stemDrift, type FileGroup, type StoredRow } from "./plan";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
type D1Like = { prepare(sql: string): Stmt; batch(statements: Stmt[]): Promise<unknown> };

const PROD_DB_NAME = "lingo-family";
const PROD_DB_ID = "10da2bc0-1ba1-4ae2-80be-df43cd5b1931";
const DOCX_DIR = "data/topik";
/** D1 refuses a statement binding more than 100 parameters; see worker/lib/d1Chunk.ts. */
const UPDATES_PER_BATCH = 40;

const args = process.argv.slice(3);
const apply = args.includes("--apply");
const local = args.includes("--local");
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const sectionArg = flag("--section");
if (sectionArg !== undefined && !(TOPIK_SECTIONS as readonly string[]).includes(sectionArg)) {
  console.error(`--section must be one of ${TOPIK_SECTIONS.join("|")} (got "${sectionArg}")`);
  process.exit(1);
}
const onlySection = (sectionArg ?? null) as TopikSection | null;

function tempConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-topik-groups-"));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "lingo-topik-groups",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: PROD_DB_ID, remote: true }],
    }),
  );
  return file;
}

function backupProduction() {
  mkdirSync("backups", { recursive: true });
  const file = path.join("backups", `prod-d1-pre-topik-groups-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
  const r = spawnSync("npx", ["wrangler", "d1", "export", PROD_DB_NAME, "--remote", "--output", file], { stdio: "inherit", shell: true });
  if (r.status !== 0 || !existsSync(file) || statSync(file).size === 0) throw new Error("Production backup failed; nothing was changed.");
  console.log(`\nProduction D1 backed up to ${file} (${statSync(file).size} bytes)`);
}

/** What every Word file says about every question's group — the same `assignGroupKeys` the import runs. */
async function groupsFromFiles(): Promise<FileGroup[]> {
  if (!existsSync(DOCX_DIR)) return [];
  const files = (await readdir(DOCX_DIR)).filter((f) => f.toLowerCase().endsWith(".docx") && !f.startsWith("~$"));
  const out: FileGroup[] = [];
  for (const fileName of files) {
    const zip = await JSZip.loadAsync(await readFile(path.join(DOCX_DIR, fileName)));
    const documentXml = await zip.file("word/document.xml")?.async("string");
    if (!documentXml) continue;
    for (const q of buildImportDraft(fileName, documentXml).questions) {
      if (onlySection && q.section !== onlySection) continue;
      out.push({ section: q.section, exam: q.exam, number: q.number, group_key: q.group_key });
    }
  }
  return out;
}

async function main() {
  console.log(apply ? `APPLY: will write to ${local ? "the LOCAL dev database" : "production"}` : "DRY RUN: nothing is written");
  console.log(`Scope: ${onlySection ? `section=${onlySection}` : "section=ALL"}`);

  const fromFiles = await groupsFromFiles();
  if (fromFiles.length === 0) {
    console.error(`No questions parsed from ${DOCX_DIR} — nothing to match against, so nothing is written.`);
    process.exit(1);
  }

  const summary = groupSummary(fromFiles);
  console.log(`\n=== Các cụm dùng chung nguồn mà file Word nói ra (${summary.length}) ===`);
  for (const g of summary) console.log(`  ${g.section.padEnd(9)} ${g.exam.padEnd(24)} câu ${g.numbers.join(", ")}`);
  if (summary.length === 0) console.log("  (không có — không file nào đánh dấu CHUNG ĐOẠN)");

  const proxy = local
    ? await getPlatformProxy({ remoteBindings: false })
    : await getPlatformProxy({ configPath: tempConfig(), remoteBindings: true });
  try {
    const db = proxy.env.DB as unknown as D1Like;
    const where = onlySection ? "WHERE section = ?1" : "";
    const stmt = db.prepare(`SELECT id, section, exam, number, group_key, stem_text FROM topik_questions ${where}`);
    const stored = (await (onlySection ? stmt.bind(onlySection) : stmt).all<StoredRow>()).results;

    const plan = planBackfill(stored, fromFiles);
    console.log(`\n=== Sẽ đổi (${plan.changes.length}) ===`);
    for (const c of plan.changes) {
      console.log(`  ${c.section.padEnd(9)} ${c.exam.padEnd(24)} #${String(c.number).padEnd(3)} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
    }
    if (plan.changes.length === 0) console.log("  (không câu nào — cột group_key đã khớp với file Word)");
    console.log(`\nGiữ nguyên: ${plan.unchanged} câu.`);

    // Reported, not written: a row the files no longer describe keeps whatever it has. Clearing it
    // as a side effect of a backfill is the kind of quiet loss this script must not be capable of.
    console.log(`\n=== Câu trong cơ sở dữ liệu mà không file Word nào phủ (${plan.orphans.length}) — bỏ qua ===`);
    for (const o of plan.orphans.slice(0, 20)) console.log(`  ${o.section.padEnd(9)} ${o.exam.padEnd(24)} #${o.number}`);
    if (plan.orphans.length > 20) console.log(`  … và ${plan.orphans.length - 20} câu nữa`);
    if (plan.orphans.length === 0) console.log("  (không có)");

    console.log(`\n=== Câu file Word có mà cơ sở dữ liệu chưa có (${plan.missing.length}) — chạy topik-import ===`);
    for (const m of plan.missing.slice(0, 20)) console.log(`  ${m.section.padEnd(9)} ${m.exam.padEnd(24)} #${m.number}`);
    if (plan.missing.length > 20) console.log(`  … và ${plan.missing.length - 20} câu nữa`);
    if (plan.missing.length === 0) console.log("  (không có)");

    const drift = stemDrift(stored, fromFiles);
    console.log(`\n=== Hai bản của một đoạn văn đã trôi khỏi nhau (${drift.length}) ===`);
    for (const d of drift) {
      console.log(`  ${d.group_key}`);
      for (const m of d.members) console.log(`    #${m.number}: ${JSON.stringify(m.stem_text)}`);
    }
    if (drift.length === 0) console.log("  (không có — mọi cụm đều khớp từng ký tự)");

    if (!apply) {
      console.log("\nDry run only. Xem bảng trên, rồi chạy lại với --apply.");
      return;
    }
    if (plan.changes.length === 0) {
      console.log("\nKhông có gì để ghi.");
      return;
    }
    if (!local) backupProduction();

    // `group_key` is the only column named. Not even `updated_at`: this fills in something the row
    // always meant, and bumping the timestamp would make it look like the question was edited.
    let written = 0;
    for (let i = 0; i < plan.changes.length; i += UPDATES_PER_BATCH) {
      const chunk = plan.changes.slice(i, i + UPDATES_PER_BATCH);
      await db.batch(chunk.map((c) => db.prepare("UPDATE topik_questions SET group_key = ?1 WHERE id = ?2").bind(c.to, c.id)));
      written += chunk.length;
    }
    console.log(`\nĐã ghi group_key cho ${written} câu. Không cột nào khác bị đụng.`);
  } finally {
    await proxy.dispose();
  }
}

await main();
