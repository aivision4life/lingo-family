// Assembles parsed TOPIK items (worker/services/topikParse.ts) into draft questions, using the
// source file's name for the block/number (never the instruction text) and the exam heading for
// grouping (M6.1). Pure: image references stay as docx relationship ids (`rId9`, …) — resolving
// them to R2 keys needs the zip's media bytes, done by the caller (scripts/topikImport).
import { parseTopikDocument } from "./topikParse";

export type TopikFileName = { start: number; end: number; source: string };

const FILE_NAME = /^TOPIK_Reading_Cau(\d+)(?:_(\d+))?_(.+)_VERSION\d+$/i;

/** "TOPIK_Reading_Cau01_02_Yonsei_VERSION1.docx" → { start: 1, end: 2, source: "Yonsei" }. */
export function parseTopikFileName(fileName: string): TopikFileName | null {
  const base = fileName.replace(/\.docx$/i, "");
  const m = FILE_NAME.exec(base);
  if (!m) return null;
  const start = Number(m[1]);
  return { start, end: m[2] ? Number(m[2]) : start, source: m[3]! };
}

export type DraftOption = { text: string; image_rid: string | null };
export type DraftQuestion = {
  section: "reading";
  exam: string;
  number: number;
  block: string;
  instruction: string | null;
  stem: { text: string | null; image_rid: string | null };
  options: DraftOption[];
  correct_option: number;
  /** Set when something about this question had to be cross-checked/guessed; shown on the review screen. */
  warning: string | null;
};

export type ImportDraft = {
  fileName: string;
  /** From the file name (authoritative; cross-checked, never overridden by the heading/instruction). */
  block: string;
  questions: DraftQuestion[];
  /** Blocking: this question was not added to `questions`. */
  errors: string[];
  /** Informational only (e.g. a label disagreeing with the computed number): still imported. */
  warnings: string[];
};

/** Builds the draft questions for one `.docx`'s `word/document.xml` text. No R2/D1 access here. */
export function buildImportDraft(fileName: string, documentXml: string): ImportDraft {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fn = parseTopikFileName(fileName);
  if (!fn) {
    errors.push(`file name does not match "TOPIK_Reading_Cau<N>[_<M>]_<source>_VERSION<v>.docx"`);
    return { fileName, block: "", questions: [], errors, warnings };
  }

  const blockSize = fn.end - fn.start + 1;
  const block = fn.start === fn.end ? String(fn.start) : `${fn.start}~${fn.end}`;
  const parsed = parseTopikDocument(documentXml);
  warnings.push(...parsed.warnings);
  if (parsed.headingBlock && (parsed.headingBlock.start !== fn.start || parsed.headingBlock.end !== fn.end)) {
    warnings.push(
      `heading says block ${parsed.headingBlock.start}~${parsed.headingBlock.end}, file name says ${fn.start}~${fn.end} (file name is used)`,
    );
  }

  const questions: DraftQuestion[] = [];
  for (const exam of parsed.exams) {
    for (const item of exam.items) {
      const number = fn.start + ((item.position - 1) % blockSize);
      // When the item's own label names a real exam round ("36회"), that round IS the exam
      // identity: "<source>-<round>", with no "연습N" — every question from that exact real exam
      // (across however many files/blocks cover it) must share one label, or a later import of
      // questions 11~30 would scatter the same exam across yet more labels and a mock test could
      // never pull one complete exam back out. Only when a file has no round at all (Yonsei) does
      // "연습N" (the file's own Heading2 group index) stand in as the exam identity instead — and
      // because the counter restarts at 1 in every file, "Yonsei-연습1" from one file and
      // "Yonsei-연습1" from another correctly merge into the same label too (both are "practice
      // set 1" from that source).
      const examLabel = item.round ? `${fn.source}-${item.round}` : `${fn.source}-연습${exam.groupIndex}`;
      let warning: string | null = null;
      if (item.labelNumber !== null && item.labelNumber !== number) {
        warning = `label says question ${item.labelNumber}, computed ${number} (computed is used)`;
        warnings.push(`${examLabel} position ${item.position}: ${warning}`);
      }
      if (item.errors.length > 0) {
        errors.push(`${examLabel} #${number}: ${item.errors.join("; ")}`);
        continue;
      }
      questions.push({
        section: "reading",
        exam: examLabel,
        number,
        block,
        instruction: item.instruction,
        stem: { text: item.stem_text, image_rid: item.stem_image_rid },
        options: item.options.map((o) => ({ text: o.text, image_rid: o.image_rid })),
        warning,
        correct_option: item.declared_correct!,
      });
    }
  }
  return { fileName, block, questions, errors, warnings };
}
