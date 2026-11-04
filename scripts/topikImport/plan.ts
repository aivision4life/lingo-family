// Pure parts of the TOPIK import (M6.1): no R2/D1/file access here, so these are easy to unit test.
import { TOPIK_SECTIONS, type TopikSection } from "../../shared/enums";
import { IMAGE_UPLOAD_TYPES } from "../../shared/image";
import { TOPIK_IMAGE_MAX_BYTES, TOPIK_IMAGE_MAX_SIDE } from "../../shared/topik";
import { imageInfo } from "../../worker/lib/imageInfo";
import { parseTopikFileName, type DraftQuestion } from "../../worker/services/topikImport";

export type MediaByRid = Map<string, { bytes: Uint8Array; contentType: string }>;

/**
 * Whether `bytes` would pass `storeUploadedImage()`'s validation (type/size/dimensions) — pure, no
 * R2 access, so the dry run can predict an image failure instead of only discovering it on
 * `--apply` (M6.1 fix: an unresolvable/invalid image used to silently become `image_key: null`).
 */
export function checkImageBytes(bytes: Uint8Array, contentType: string): { ok: true } | { ok: false; reason: string } {
  const type = contentType.split(";")[0]!.trim();
  if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(type)) return { ok: false, reason: `unsupported content type "${type}"` };
  if (bytes.length === 0) return { ok: false, reason: "empty file" };
  if (bytes.length > TOPIK_IMAGE_MAX_BYTES) return { ok: false, reason: `${bytes.length} bytes exceeds the ${TOPIK_IMAGE_MAX_BYTES}-byte limit` };
  const info = imageInfo(bytes);
  const expected = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[type];
  if (info.ext !== expected) return { ok: false, reason: `file content does not look like a ${type}` };
  if (info.width <= 0 || info.height <= 0) return { ok: false, reason: "could not read the image's pixel size" };
  if (info.width > TOPIK_IMAGE_MAX_SIDE || info.height > TOPIK_IMAGE_MAX_SIDE) {
    return { ok: false, reason: `${info.width}x${info.height}px exceeds the ${TOPIK_IMAGE_MAX_SIDE}px limit` };
  }
  return { ok: true };
}

/** Every image reference a question has (stem + its 4 options), stem first. */
export function imageRefsOf(q: DraftQuestion): string[] {
  return [q.stem.image_rid, ...q.options.map((o) => o.image_rid)].filter((r): r is string => r !== null);
}

/**
 * Checks every image reference a question has, without touching R2: a reference whose media
 * couldn't be found in the docx, or whose bytes would fail validation, is reported here instead of
 * silently becoming a missing image later (M6.1 fix). Runs in dry-run too, so the report already
 * shows which questions would fail before anything is written.
 */
export function checkQuestionImages(q: DraftQuestion, mediaByRid: MediaByRid): string[] {
  const errors: string[] = [];
  for (const rid of imageRefsOf(q)) {
    const media = mediaByRid.get(rid);
    if (!media) {
      errors.push(`image ${rid} is referenced but was not found in word/media`);
      continue;
    }
    const check = checkImageBytes(media.bytes, media.contentType);
    if (!check.ok) errors.push(`image ${rid}: ${check.reason}`);
  }
  return errors;
}

/**
 * `--force`'s default behavior resets `verified` to false on an overwrite — content changed, so an
 * adult should look at it again before it goes back into practice. `--keep-verified` opts out of
 * that for a touch-up re-import that does not actually change the question's meaning (e.g. a parser
 * fix that only adds line breaks): the row keeps whatever `verified` it already had, so an already
 * reviewed-and-studied question (with FSRS progress on it) does not need re-approving.
 */
export function verifiedAfterOverwrite(existingVerified: boolean, keepVerified: boolean): boolean {
  return keepVerified ? existingVerified : false;
}

export type CoverageQuestion = { exam: string; number: number };

/**
 * Groups that hold fewer questions than the file's own name asks for (M7.8).
 *
 * The parser counts `Heading3` labels and nothing else: it has no idea that a file called
 * `Cau16_18` promises three questions per exam, so a group that was only typed up to question 17
 * parses cleanly, imports cleanly and goes unnoticed — until something else trips over the hole
 * (the mock test needs numbers running from 1, and simply offers a shorter paper). The file name
 * is the one place that states the intent, so this compares the two and says so out loud.
 *
 * A **warning**, never an error: typing up a paper over several evenings is the normal way to work,
 * and a half-finished group must still import.
 */
export function shortGroups(
  questions: readonly CoverageQuestion[],
  start: number,
  end: number,
): { exam: string; have: number; want: number; missing: number[] }[] {
  const want = end - start + 1;
  const byExam = new Map<string, Set<number>>();
  for (const q of questions) byExam.set(q.exam, (byExam.get(q.exam) ?? new Set()).add(q.number));

  const out: { exam: string; have: number; want: number; missing: number[] }[] = [];
  for (const [exam, numbers] of byExam) {
    if (numbers.size >= want) continue;
    const missing = [];
    for (let n = start; n <= end; n += 1) if (!numbers.has(n)) missing.push(n);
    out.push({ exam, have: numbers.size, want, missing });
  }
  return out;
}

/**
 * Per exam: how many questions exist, and **how far the numbering runs unbroken from 1** — which
 * is exactly how many a mock test of that paper can use (`isContiguousFromOne`). A hole at question
 * 5 makes a 14-question paper a 4-question one, and nothing else in the pipeline says so.
 *
 * This also catches what `shortGroups` cannot: a whole exam missing from one file leaves no short
 * group to find, because the group is not there at all.
 */
export function examCoverage(questions: readonly CoverageQuestion[]): { exam: string; count: number; usable: number }[] {
  const byExam = new Map<string, Set<number>>();
  for (const q of questions) byExam.set(q.exam, (byExam.get(q.exam) ?? new Set()).add(q.number));
  return [...byExam.entries()]
    .map(([exam, numbers]) => {
      let usable = 0;
      while (numbers.has(usable + 1)) usable += 1;
      return { exam, count: numbers.size, usable };
    })
    .sort((a, b) => a.exam.localeCompare(b.exam));
}

/** Which source files a run is limited to; `null` means "no limit on this axis". */
export type ImportFilter = { section: TopikSection | null; source: string | null };

/** `--section` validation: an unknown value is an error, never a silent "no filter". */
export function parseSectionFlag(value: string | undefined): { ok: true; section: TopikSection | null } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true, section: null };
  const section = value.trim().toLowerCase();
  if (!(TOPIK_SECTIONS as readonly string[]).includes(section)) {
    return { ok: false, reason: `--section must be one of ${TOPIK_SECTIONS.join("|")} (got "${value}")` };
  }
  return { ok: true, section: section as TopikSection };
}

/**
 * Whether one `.docx` is in scope, decided from its *file name* alone (so it applies identically to
 * the dry run and to `--apply`). A file name this project cannot parse always passes: it must still
 * reach `buildImportDraft`, which reports it as an error — dropping it here would hide a typo'd
 * file name behind "0 files matched".
 */
export function fileMatchesFilter(fileName: string, filter: ImportFilter): boolean {
  const fn = parseTopikFileName(fileName);
  if (!fn) return true;
  if (filter.section && fn.section !== filter.section) return false;
  if (filter.source && fn.source.toLowerCase() !== filter.source.toLowerCase()) return false;
  return true;
}

/** Human-readable scope for the report's header and totals line. */
export function filterLabel(filter: ImportFilter): string {
  const parts: string[] = [];
  parts.push(filter.section ? `section=${filter.section}` : "section=ALL");
  if (filter.source) parts.push(`source=${filter.source}`);
  return parts.join(", ");
}

/**
 * Guard against the one irreversible mistake this script can make: `--force` with no `--section`
 * UPDATEs every existing question it parsed, across both sections, and (without `--keep-verified`)
 * resets their `verified` — silently un-approving reviewed questions in a section the run was never
 * meant to touch. Returns the abort message, or null when the run may proceed: a section was named,
 * `--all-sections` says every section is deliberate, or nothing existing would be overwritten at
 * all. The caller must call this *before* the backup and before any write.
 */
export function forceScopeProblem(args: {
  force: boolean;
  section: TopikSection | null;
  allSections: boolean;
  existingBySection: Partial<Record<TopikSection, number>>;
}): string | null {
  if (!args.force || args.section !== null || args.allSections) return null;
  const counts = TOPIK_SECTIONS.map((s) => [s, args.existingBySection[s] ?? 0] as const).filter(([, n]) => n > 0);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  if (total === 0) return null;
  const breakdown = counts.map(([s, n]) => `${s} ${n}`).join(", ");
  return (
    `--force without --section would overwrite ${total} existing question(s): ${breakdown}.\n` +
    `Add --section ${TOPIK_SECTIONS.join("|")} to limit the run, or --all-sections to confirm every section on purpose.`
  );
}
