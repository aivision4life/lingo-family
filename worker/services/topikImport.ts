// Assembles parsed TOPIK items (worker/services/topikParse.ts) into draft questions, using the
// source file's name for the block/number (never the instruction text) and the exam heading for
// grouping (M6.1). Pure: image references stay as docx relationship ids (`rId9`, …) — resolving
// them to R2 keys needs the zip's media bytes, done by the caller (scripts/topikImport).
import type { TopikSection } from "../../shared/enums";
import { DEFAULT_QUESTION_POINTS, pointsFromInstruction } from "../../shared/topik";
import { parseTopikDocument } from "./topikParse";

/**
 * The two shapes a source file comes in (M7.16).
 *
 * `block`: one *block of questions* ("Cau16_18"), several exams deep — how the bank was first typed
 * up, one task at a time across many papers. The name carries the block, because nothing inside the
 * file does.
 *
 * `paper`: one whole exam, all fifty questions, twenty blocks ("TOPIK_II_Test35_Listening_
 * OfficialTest.docx") — how complete papers arrive. No range can go in the name here, and none
 * needs to: each question's own "[N~M] …" line states its block, which is the paper's real
 * grouping rather than a stand-in for it. `test` is **not** used to decide anything; it is only
 * cross-checked against the round in the document, so a mis-named copy is caught.
 */
export type TopikFileName =
  | { kind: "block"; section: TopikSection; start: number; end: number; source: string }
  | { kind: "paper"; section: TopikSection; source: string; test: number };

const FILE_NAME = /^TOPIK_(Reading|Listening)_Cau(\d+)(?:_(\d+))?_(.+)_VERSION\d+$/i;
const PAPER_FILE_NAME = /^TOPIK_II_Test(\d+)_(Reading|Listening)_(.+)$/i;

/** "TOPIK_Reading_Cau01_02_Yonsei_VERSION1.docx" → a block file; "TOPIK_II_Test35_Listening_
 * OfficialTest.docx" → a whole paper. Anything else is rejected by name. */
export function parseTopikFileName(fileName: string): TopikFileName | null {
  const base = fileName.replace(/\.docx$/i, "");
  const m = FILE_NAME.exec(base);
  if (m) {
    const start = Number(m[2]);
    return { kind: "block", section: m[1]!.toLowerCase() as TopikSection, start, end: m[3] ? Number(m[3]) : start, source: m[4]! };
  }
  const p = PAPER_FILE_NAME.exec(base);
  if (p) return { kind: "paper", section: p[2]!.toLowerCase() as TopikSection, source: p[3]!, test: Number(p[1]) };
  return null;
}

/**
 * The block a question belongs to, read from its own instruction line ("[13~16] 다음을 듣고 …").
 *
 * This is where a whole paper's blocks come from, and it is a better source than the file name ever
 * was: the paper itself prints the grouping. Returns null when the line has no bracket at all,
 * which is refused rather than guessed — a question with no block would land in its own one-question
 * group in the practice picker and nobody would notice.
 */
export function blockRangeOf(instruction: string | null): { start: number; end: number } | null {
  const m = /^\s*\[\s*(\d+)\s*(?:[~～-]\s*(\d+))?\s*\]/.exec(instruction ?? "");
  if (!m) return null;
  const start = Number(m[1]);
  return { start, end: m[2] ? Number(m[2]) : start };
}

const blockLabel = (range: { start: number; end: number }) =>
  range.start === range.end ? String(range.start) : `${range.start}~${range.end}`;

/**
 * A line that begins a speaker's turn: a short label, then a colon ("남자 :", "여자2:", "직원:").
 *
 * Deliberately not a list of the two labels we expect. One file has "남잠:" — a typo for "남자" —
 * and with a fixed list that line was not a turn, so rejoining glued two speakers' turns into one.
 * A rule that errs toward "this is a turn" only ever leaves a line where it was; a rule that errs
 * the other way destroys the text. The colon has to come within a few characters and with no space
 * before it, which no continuation of a sentence does.
 */
const SPEAKER_LABEL = /^[^\s:]{1,8}\s*:/;

/**
 * Lines of a listening transcript that do not begin a speaker's turn (M7.16).
 *
 * In these files a turn is one line. A line that starts mid-sentence is therefore a hard line
 * break someone typed where Word had wrapped the text visually — harmless on screen, but it is
 * also what the vocabulary and the explanation are generated from, and before `<w:br/>` was kept
 * it was worse than harmless: the two lines were joined with nothing between them and the words
 * either side were glued into one ("나타났으며" + "10대가").
 *
 * Reported for every file, every run, so this is noticed on arrival instead of surfacing years
 * later as a word nobody can look up. Empty when the stem has no speaker label at all (an
 * announcement, an image-only question): there is nothing to judge against.
 */
export function wrappedTranscriptLines(stemText: string | null): string[] {
  const lines = (stemText ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length < 2 || !SPEAKER_LABEL.test(lines[0]!)) return [];
  return lines.slice(1).filter((l) => !SPEAKER_LABEL.test(l));
}

/**
 * Puts a transcript's turns back on one line each (M7.16).
 *
 * Word wraps a long turn visually, and whoever typed these papers pressed Enter at each wrap, so a
 * single turn arrives as four or five lines — 1003 of them across the four papers, far too many to
 * ask anyone to undo by hand. The repair is deterministic rather than a guess: a line that does
 * not start a speaker's turn is the continuation of the one above it, and the wrap it replaced sat
 * at a space, so the two are joined with a space.
 *
 * Checked against the 22 of these questions that were typed up properly by hand and are already in
 * the bank: after this, the repaired text matches theirs.
 */
export function mergeWrappedTranscript(stemText: string | null): string | null {
  if (stemText === null) return null;
  const lines = stemText.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length < 2 || !SPEAKER_LABEL.test(lines[0]!)) return stemText;
  const turns: string[] = [];
  for (const line of lines) {
    if (SPEAKER_LABEL.test(line) || turns.length === 0) turns.push(line);
    else turns[turns.length - 1] = `${turns[turns.length - 1]} ${line}`;
  }
  return turns.join("\n").replace(/[ \t]{2,}/g, " ");
}

export type BlockLine = { range: { start: number; end: number }; text: string };

/**
 * Every "[N~M] …" line in one exam group, whichever question it was parsed with.
 *
 * In a whole-paper file the line sits **between** two questions — after question 3's table, before
 * question 4's heading — and a paragraph between two questions belongs to the one before it
 * (M7.3). So the line that opens block 4~8 arrives attached to question 3. Rather than guess from
 * where it sits, the line is matched to questions by the range it **states**: it says 4~8, so it
 * belongs to 4 to 8, and question 3 keeps the block before it. Nothing here depends on layout.
 */
export function blockLinesOf(items: readonly { instruction: string | null; block_instruction: string | null }[]): BlockLine[] {
  const byRange = new Map<string, BlockLine>();
  for (const item of items) {
    for (const candidate of [item.block_instruction, item.instruction?.split("\n")[0] ?? null]) {
      const range = blockRangeOf(candidate);
      if (range && candidate) byRange.set(blockLabel(range), { range, text: candidate });
    }
  }
  return [...byRange.values()];
}

/** The line a question belongs to: the one whose stated range covers its number. */
export const blockLineFor = (lines: readonly BlockLine[], number: number): BlockLine | null =>
  lines.find((l) => number >= l.range.start && number <= l.range.end) ?? null;

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
    errors.push(
      `file name matches neither "TOPIK_(Reading|Listening)_Cau<N>[_<M>]_<source>_VERSION<v>.docx" ` +
        `nor "TOPIK_II_Test<N>_(Reading|Listening)_<source>.docx"`,
    );
    return { fileName, block: "", questions: [], errors, warnings };
  }

  const paper = fn.kind === "paper";
  const blockSize = paper ? 0 : fn.end - fn.start + 1;
  // A whole paper has twenty blocks, so the file's own `block` is only a label for the report.
  const block = paper ? `Test${fn.test}` : blockLabel({ start: fn.start, end: fn.end });
  const parsed = parseTopikDocument(documentXml);
  warnings.push(...parsed.warnings);
  if (!paper && parsed.headingBlock && (parsed.headingBlock.start !== fn.start || parsed.headingBlock.end !== fn.end)) {
    warnings.push(
      `heading says block ${parsed.headingBlock.start}~${parsed.headingBlock.end}, file name says ${fn.start}~${fn.end} (file name is used)`,
    );
  }
  // `Test35` in the name decides nothing — the round in the document does — but the two
  // disagreeing means someone saved a copy under the wrong name, which is worth saying once.
  if (paper) {
    const rounds = [...new Set(parsed.exams.map((e) => e.round).filter((r): r is string => !!r))];
    const expected = `${fn.test}회`;
    if (rounds.length > 0 && !rounds.includes(expected)) {
      warnings.push(`file name says Test${fn.test} but the document's round is ${rounds.join(", ")} (the document is used)`);
    }
  }

  const questions: DraftQuestion[] = [];
  for (const exam of parsed.exams) {
    // A whole paper carries its own grouping; a block file has one block, stated by its name.
    const blockLines = paper ? blockLinesOf(exam.items) : [];
    for (const item of exam.items) {
      // A block file numbers by position inside its own range; a whole paper's questions are
      // numbered by the paper, which is what the Heading3 label says.
      const number = paper ? (item.paperNumber ?? item.labelNumber ?? item.position) : fn.start + ((item.position - 1) % blockSize);
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
      // The reading 1-4 patch belongs to the block shape only: it exists because one block file
      // covers two tasks at once. A whole paper states every block itself.
      const readingFix = !paper && fn.section === "reading";
      const notes: string[] = [];
      if (!paper && item.labelNumber !== null && item.labelNumber !== number) {
        notes.push(`label says question ${item.labelNumber}, computed ${number} (computed is used)`);
      }
      if (paper && item.paperNumber === null && item.labelNumber === null) {
        notes.push(`no question number label; counted as question ${number} from its position in the paper`);
      }
      // Imported, but surfaced first in the review screen (e.g. the underline disagrees with the
      // answer label on a listening question, where the label is what counts).
      notes.push(...item.warnings);
      // A transcript line that does not start a turn is a line break typed at a visual wrap.
      const wrapped = fn.section === "listening" ? wrappedTranscriptLines(item.stem_text) : [];
      if (wrapped.length > 0) {
        // The report, not the row's own `warning`: that column is for something an adult has to
        // look at, and a repair that is deterministic and verified is not one of those.
        warnings.push(`${examLabel} #${number}: joined ${wrapped.length} line break(s) typed mid-turn`);
      }
      const stemText = fn.section === "listening" ? mergeWrappedTranscript(item.stem_text) : item.stem_text;
      const warning = notes.length > 0 ? notes.join("; ") : null;
      // A whole paper's question takes the block line that covers its number, plus its own "HỎI:"
      // line — never the line it happened to be parsed next to.
      const ownLine = paper ? blockLineFor(blockLines, number) : null;
      const instruction = paper
        ? ([ownLine?.text ?? null, item.own_instruction].filter((x): x is string => !!x).join("\n") || null)
        : item.instruction;
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
      // A whole paper's block comes from the question's own "[N~M]" line. No line, no block: a
      // question nobody can place is refused, not filed under a made-up group.
      const ownBlock = ownLine?.range ?? null;
      if (paper && !ownBlock) {
        errors.push(`${examLabel} #${number}: no "[N~M] …" block line to read the block from`);
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
        block: ownBlock ? blockLabel(ownBlock) : ((readingFix ? FIXED_NUMBER_BLOCK[number] : undefined) ?? block),
        instruction,
        points: pointsFromInstruction(instruction) ?? DEFAULT_QUESTION_POINTS,
        same_segment: item.same_segment,
        stem: { text: stemText, image_rid: item.stem_image_rid },
        options: item.options.map((o) => ({ text: o.text, image_rid: o.image_rid })),
        warning,
        correct_option: item.declared_correct!,
      });
    }
  }
  return { fileName, block, questions, errors, warnings };
}
