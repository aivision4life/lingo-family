// Assembles parsed TOPIK items (worker/services/topikParse.ts) into draft questions, using the
// source file's name for the block/number (never the instruction text) and the exam heading for
// grouping (M6.1). Pure: image references stay as docx relationship ids (`rId9`, …) — resolving
// them to R2 keys needs the zip's media bytes, done by the caller (scripts/topikImport).
import type { TopikSection } from "../../shared/enums";
import { DEFAULT_QUESTION_POINTS, pointsFromInstruction } from "../../shared/topik";
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
  /** From the instruction's own "각 N점" (M6.4); the default when the paper does not say. */
  points: number;
  /** Listening (M7.1): shares the previous question's audio clip instead of opening a new one. */
  same_segment: boolean;
  stem: { text: string | null; image_rid: string | null };
  options: DraftOption[];
  correct_option: number;
  /** Set when something about this question had to be cross-checked/guessed; shown on the review screen. */
  warning: string | null;
};

/**
 * Reading questions 1-4 are two different tasks (1-2: fill in the blank; 3-4: choose the closest
 * meaning to an underlined phrase), so they are two different blocks — but one real source file
 * covers all four at once ("Cau01_04_8DeOfficial"), and `block` otherwise comes from the file name
 * and would be the file-wide "1~4" for every one of them. The number decides it instead.
 *
 * There used to be a twin of this for the instruction text (M7.3-era), because several files
 * carried the wrong "[1~2] …" line on their 3-4 questions or no line at all. That is now fixed in
 * the Word files themselves (M7.7), so the patch is gone: the instruction comes from the file, and
 * the file alone. Verified against production before removing it — every question 1-12 carried the
 * instruction of its own block, and a re-import changed nothing.
 *
 * Reading only: in the listening paper those same numbers are a completely different task.
 */
const FIXED_NUMBER_BLOCK: Record<number, string> = { 1: "1~2", 2: "1~2", 3: "3~4", 4: "3~4" };

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
  const parsed = parseTopikDocument(documentXml, fn.section);
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
      // The item's own label wins over the group's: one Heading2 group can hold items from several
      // different real rounds (Cau09/Cau10), which is why the item-level round exists at all. The
      // group's heading is the fallback, and the listening files use it exclusively — the round
      // sits in Heading2 and Heading3 stays a plain question number.
      const round = item.round ?? exam.round;
      const examLabel = round ? `${fn.source}-${round}` : `${fn.source}-연습${exam.groupIndex}`;
      const readingFix = fn.section === "reading";
      const notes: string[] = [];
      if (item.labelNumber !== null && item.labelNumber !== number) {
        notes.push(`label says question ${item.labelNumber}, computed ${number} (computed is used)`);
      }
      // Imported, but surfaced first in the review screen (e.g. the underline disagrees with the
      // answer label on a listening question, where the label is what counts).
      notes.push(...item.warnings);
      const warning = notes.length > 0 ? notes.join("; ") : null;
      const instruction = item.instruction;
      for (const note of notes) warnings.push(`${examLabel} #${number}: ${note}`);

      // Nothing typed into a question may be thrown away in silence (M7.3). Three separate losses
      // of real work went unnoticed exactly that way, so an unaccounted-for paragraph is reported
      // verbatim, with the question it was in.
      //
      // Where it sits decides how loudly. Before or between the question's own parts, it is
      // content meant to be read and the question is refused rather than imported incomplete —
      // the fix is to mark the line ("HỎI: …") or to move it. After the four options is the file
      // author's own note area (Vietnamese glosses, "관람료: phí, tiền vé"), which was never part
      // of the question: it is listed in the report and left out, without failing the question.
      const stray = item.ignored.filter((g) => !g.after_options);
      const authorNotes = item.ignored.filter((g) => g.after_options);
      for (const note of authorNotes) warnings.push(`${examLabel} #${number}: note after the options, not imported: "${note.text}"`);
      if (stray.length > 0) {
        errors.push(
          `${examLabel} #${number}: ${stray.length} paragraph(s) belong to no part of the question — ` +
            `mark a question line with "HỎI: " or move it: ${stray.map((g) => `"${g.text}"`).join(", ")}`,
        );
        continue;
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
        instruction,
        points: pointsFromInstruction(instruction) ?? DEFAULT_QUESTION_POINTS,
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
