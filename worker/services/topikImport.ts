// Assembles parsed TOPIK items (worker/services/topikParse.ts) into draft questions, using the
// source file's name for the block/number (never the instruction text) and the exam heading for
// grouping (M6.1). Pure: image references stay as docx relationship ids (`rId9`, …) — resolving
// them to R2 keys needs the zip's media bytes, done by the caller (scripts/topikImport).
import type { TopikSection } from "../../shared/enums";
import { parseTopikDocument } from "./topikParse";

export type TopikFileName = { section: TopikSection; start: number; end: number; source: string };

const FILE_NAME = /^TOPIK_(Reading|Listening)_Cau(\d+)(?:_(\d+))?_(.+)_VERSION\d+$/i;

/** "TOPIK_Reading_Cau01_02_Yonsei_VERSION1.docx" → { section: "reading", start: 1, end: 2, source: "Yonsei" }. */
export function parseTopikFileName(fileName: string): TopikFileName | null {
  const base = fileName.replace(/\.docx$/i, "");
  const m = FILE_NAME.exec(base);
  if (!m) return null;
  const start = Number(m[2]);
  const section = m[1]!.toLowerCase() as TopikSection;
  return { section, start, end: m[3] ? Number(m[3]) : start, source: m[4]! };
}

export type DraftOption = { text: string; image_rid: string | null };
export type DraftQuestion = {
  section: TopikSection;
  exam: string;
  number: number;
  block: string;
  instruction: string | null;
  /** Listening (M7.1): shares the previous question's audio clip instead of opening a new one. */
  same_segment: boolean;
  stem: { text: string | null; image_rid: string | null };
  options: DraftOption[];
  correct_option: number;
  /** Set when something about this question had to be cross-checked/guessed; shown on the review screen. */
  warning: string | null;
};

/**
 * TOPIK II reading's question numbers 1-4 are a fixed, standardized format across every real exam
 * and every practice-sheet source (1-2: fill in the blank; 3-4: choose the closest meaning to an
 * underlined phrase) — the block and instruction text never actually vary by file. Overriding both
 * from the number alone, instead of trusting whatever the source file's heading/instruction
 * paragraph says, fixes two real problems at once: a legacy merged "Cau01_04" file (one file
 * covering both pairs at once, `block` would otherwise be the file-wide "1~4" for all four) needs
 * to split into "1~2"/"3~4" like every other file; and the "[3~4] ..." instruction, when the file
 * has it at all, is written once per *file* (not once per round) in the middle of question 3's own
 * body, which this parser does not otherwise recognize as an instruction — and at least one real
 * source file (Yonsei) never has the right text in the first place (a leftover copy-paste of the
 * "[1~2]..." instruction). A no-op for a properly single-pair file: its own number/block already
 * agree with these constants.
 */
// Reading only: in the listening paper those same numbers are a completely different task.
const FIXED_NUMBER_BLOCK: Record<number, string> = { 1: "1~2", 2: "1~2", 3: "3~4", 4: "3~4" };
const FIXED_NUMBER_INSTRUCTION: Record<number, string> = {
  3: "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오.",
  4: "[3~4] 다음 밑줄 친 부분과 의미가 비슷한 것을 고르십시오.",
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
    errors.push(`file name does not match "TOPIK_(Reading|Listening)_Cau<N>[_<M>]_<source>_VERSION<v>.docx"`);
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
      const readingFix = fn.section === "reading";
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
        section: fn.section,
        exam: examLabel,
        number,
        block: (readingFix ? FIXED_NUMBER_BLOCK[number] : undefined) ?? block,
        instruction: (readingFix ? FIXED_NUMBER_INSTRUCTION[number] : undefined) ?? item.instruction,
        same_segment: item.same_segment,
        stem: { text: item.stem_text, image_rid: item.stem_image_rid },
        options: item.options.map((o) => ({ text: o.text, image_rid: o.image_rid })),
        warning,
        correct_option: item.declared_correct!,
      });
    }
  }
  return { fileName, block, questions, errors, warnings };
}
