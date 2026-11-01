// Pure parsing of a TOPIK reading practice .docx's `word/document.xml` (M6.1): no file/network I/O
// here, so it is easy to unit test with small synthetic XML fixtures (the real exam files are
// copyrighted and never committed — see scripts/topikImport).
//
// Document shape (reverse-engineered from real files, see CLAUDE.md "TOPIK import" note):
//   Heading1  "유형K: 문항 N~M" or "문항 N"      → cross-checked against the file name's block
//   Heading2  "<label> (<round>)" etc.           → one `exam` group (repeats for 연습1, 연습2, …)
//   (plain)   "[N~M] <instruction>"               → the instruction, repeats once per Heading2 group
//   Heading3  "K-i" / "K-i (<round>)"             → marks the start of one question
//   (plain)   "X(Y)"                              → declared answer: Y is the 1-based option
//   then either
//     - a 2-column table: row 0 (spans both columns) = stem; rows 1-2 = options 1,2 then 3,4
//     - or: an optional stem image (drawing), then exactly 4 "ListParagraph" options
//   The one option whose runs are underlined is the model's own answer; it must agree with Y.
import { XMLParser } from "fast-xml-parser";
import { TOPIK_OPTION_COUNT } from "../../shared/topik";

// --- Generic helpers for fast-xml-parser's `preserveOrder: true` shape ---------------------------

type Attrs = Record<string, string>;
type OrderedNode = { ":@"?: Attrs; "#text"?: string } & Record<string, OrderedNode[] | string | Attrs | undefined>;

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: false });

/** The node's own tag name (every node has exactly one, besides the reserved ":@" attributes key). */
function tagOf(node: OrderedNode): string | null {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}
function childrenOf(node: OrderedNode): OrderedNode[] {
  const tag = tagOf(node);
  const v = tag ? node[tag] : undefined;
  return Array.isArray(v) ? v : [];
}
function attrsOf(node: OrderedNode): Attrs {
  return node[":@"] ?? {};
}

/** All text directly or indirectly under `node` (paragraph, table cell, run, …), in document order. */
function textOf(node: OrderedNode): string {
  if (tagOf(node) === "#text") return (node["#text"] as string | undefined) ?? "";
  return childrenOf(node).map(textOf).join("");
}

/** The r:embed id (if any) of the first image found anywhere under `node`. */
function embedIdOf(node: OrderedNode): string | null {
  const a = attrsOf(node)["@_r:embed"];
  if (a) return a;
  for (const child of childrenOf(node)) {
    const found = embedIdOf(child);
    if (found) return found;
  }
  return null;
}

/** True when any run anywhere under `node` is underlined (the convention marking the correct option). */
function hasUnderline(node: OrderedNode): boolean {
  if (tagOf(node) === "w:u" && attrsOf(node)["@_w:val"] !== "none") return true;
  return childrenOf(node).some(hasUnderline);
}

const headingStyle = (p: OrderedNode): string | null => {
  for (const c of childrenOf(p)) {
    if (tagOf(c) === "w:pPr") {
      for (const pc of childrenOf(c)) {
        if (tagOf(pc) === "w:pStyle") {
          const val = attrsOf(pc)["@_w:val"];
          if (val) return val;
        }
      }
    }
  }
  return null;
};

// --- TOPIK-specific structures -------------------------------------------------------------------

export type ParsedOption = { text: string; marked: boolean; image_rid: string | null };
export type ParsedItem = {
  /** Position within its exam group (1-based); the actual question `number` is `block.start + position - 1`. */
  position: number;
  /** The "-N" suffix of the Heading3 label, when parseable — cross-checked against the computed number. */
  labelNumber: number | null;
  /**
   * The "(XX회)" real-exam-round suffix on the Heading3 label, when present (e.g. "36회"). Some
   * files put one Heading2 group's items under several different real exam administrations
   * (Cau09/Cau10: one "연습1: Official" group holds 7 unrelated questions, "1-9 (36회)" .. "1-9
   * (64회)") — without this, those items would collide on the same `exam` identity (M6.1 bug: 12
   * of 14 image questions were silently dropped as "duplicates" on the first real import).
   */
  round: string | null;
  instruction: string | null;
  /** Listening (M7.1): the file marked this question as sharing the previous one's audio clip. */
  same_segment: boolean;
  stem_text: string | null;
  stem_image_rid: string | null;
  options: ParsedOption[];
  /** The 1-based option the answer label declares correct (null when the label itself is malformed). */
  declared_correct: number | null;
  errors: string[];
};

/**
 * `groupIndex` is a 1-based counter of the file's Heading2 groups that actually hold questions,
 * independent of the group's own heading text (which varies a lot: "Yonsei-연습1", "연습1 (35회)",
 * "연습1: Official"). A group with no `Heading3` label at all gets `0` and does not consume an
 * index: Word files really do contain a blank paragraph accidentally styled Heading 2 (seen in
 * Cau05_08_MasterTopik, between "Master 7" and "Master 8"), and counting it would silently shift
 * the `연습N` exam label of every later group in that file.
 *
 * "Holds questions" is deliberately a *structural* test (`items.length > 0`, i.e. at least one
 * Heading3), never "parsed without errors": a group whose questions all fail to parse today must
 * still consume its index, or fixing that group's input file tomorrow would renumber every later
 * group and orphan the rows already imported under the old labels.
 */
export type ParsedExam = {
  exam: string;
  groupIndex: number;
  /**
   * The real exam round named by the group's own Heading2 ("35회", "연습1 (35회)"), if any.
   * Used when an item's own Heading3 label does not name one — the listening files put the round
   * here and keep Heading3 as a plain question number, which is the tidier convention.
   */
  round: string | null;
  items: ParsedItem[];
};

export type ParseDocumentResult = {
  /** [start, end] parsed from the Heading1 text, when found (cross-check only; the caller trusts the file name). */
  headingBlock: { start: number; end: number } | null;
  exams: ParsedExam[];
  /** File-level problems that are not tied to one question (e.g. no Heading1 found at all). */
  warnings: string[];
};

const ANSWER_LABEL = /^(\d+)\s*\((\d+)\)$/;
/**
 * Listening only (M7.1): this question is asked about the *previous* question's audio clip (a
 * dialogue followed by two questions). Most questions have a clip of their own, so the file marks
 * the minority — less to type and less to get wrong than numbering every question's segment.
 * Written with or without Vietnamese diacritics, in any case.
 */
const SAME_SEGMENT = /^chung\s*(đoạn|doan)$/i;
/** A real exam round anywhere in a heading: "35회", "(35회)", "연습1 (35회)". */
const ROUND_IN_TEXT = /(\d+회)/;
/** "유형1: 문항 1~2" / "문항 9" — the block is always the trailing number(s). */
const HEADING1_BLOCK = /(\d+)\s*(?:~\s*(\d+))?\s*$/;

/**
 * All text in a table cell, one line per direct `<w:p>` paragraph (joined with "\n"): a cell can
 * hold several paragraphs — e.g. a sentence-ordering stem's "(가)…"/"(나)…"/"(다)…"/"(라)…" lines,
 * each its own paragraph in the source Word file. `textOf()` alone would run them together with no
 * separator at all. A single-paragraph cell (the common case) behaves exactly as before.
 *
 * Plain text only — never used for an option (its own underline means "this is the correct
 * answer", a separate boolean (`ParsedOption.marked`), and must never be mixed into the option's
 * displayed text as markup). See `stemCellText` below for the stem's own, different use of underline.
 */
function cellText(cell: OrderedNode): string {
  return childrenOf(cell)
    .filter((c) => tagOf(c) === "w:p")
    .map((p) => textOf(p).trim())
    .filter((t) => t !== "")
    .join("\n");
}

/** Recursively collects every `w:r` run under `node`, in document order — same "walk the whole
 * tree" approach as `textOf`/`hasUnderline`, so a run nested inside a hyperlink or revision mark is
 * still found. */
function collectRuns(node: OrderedNode, out: OrderedNode[]): void {
  if (tagOf(node) === "w:r") {
    out.push(node);
    return;
  }
  for (const child of childrenOf(node)) collectRuns(child, out);
}

/** Like `textOf`, but wraps each maximal run of consecutive underlined `w:r`s in `<u>…</u>`. Used
 * only for a question's STEM: some question types (문항 3-4's "choose the closest meaning to the
 * underlined part") underline a phrase in the stem itself — a completely different use of
 * underline than an option's "this is the correct answer" marker, which stays the separate
 * `ParsedOption.marked` boolean and is never touched by this function. `<u>`/`</u>` are plain
 * literal text here; shared/topik.ts#splitUnderline is the only place that interprets them as
 * markup, and only exactly these two tags — any other `<...>` the source text happens to contain
 * is left alone. */
function paragraphTextWithUnderline(p: OrderedNode): string {
  const runs: OrderedNode[] = [];
  collectRuns(p, runs);
  let out = "";
  let i = 0;
  while (i < runs.length) {
    const underlined = hasUnderline(runs[i]!);
    let text = textOf(runs[i]!);
    i++;
    while (i < runs.length && hasUnderline(runs[i]!) === underlined) {
      text += textOf(runs[i]!);
      i++;
    }
    out += underlined ? `<u>${text}</u>` : text;
  }
  return out;
}

function stemCellText(cell: OrderedNode): string {
  return childrenOf(cell)
    .filter((c) => tagOf(c) === "w:p")
    .map((p) => paragraphTextWithUnderline(p).trim())
    .filter((t) => t !== "")
    .join("\n");
}

function parseTable(tbl: OrderedNode): { stem_text: string; stem_image_rid: string | null; options: ParsedOption[] } {
  const rows = childrenOf(tbl).filter((c) => tagOf(c) === "w:tr");
  const cellsOf = (row: OrderedNode) => childrenOf(row).filter((c) => tagOf(c) === "w:tc");
  // The stem row is usually one merged cell, but a review-card/notice question can split it in
  // two (a rating on the left, the review text on the right — Cau05_08_MasterTopik 연습1 #8).
  // Taking only the first cell silently dropped half the question, so every cell is kept.
  const stemCells = rows[0] ? cellsOf(rows[0]) : [];
  const stem_text = stemCells
    .map(stemCellText)
    .filter((text) => text !== "")
    .join("\n");
  const stem_image_rid = stemCells.map(embedIdOf).find((rid) => rid !== null) ?? null;

  // A blank spacer row between the stem and the options is real (same file): counted as an option
  // cell it shifted every option by one, which then looked like "the wrong option is underlined".
  // A cell holding only an image is a legitimate option, so emptiness alone is not the test.
  const optionCells = rows
    .slice(1)
    .flatMap(cellsOf)
    .filter((cell) => cellText(cell).trim() !== "" || embedIdOf(cell) !== null);
  const options: ParsedOption[] = optionCells.slice(0, TOPIK_OPTION_COUNT).map((cell) => ({
    // Cell text is "1) 일어나는데" etc.; drop the leading "N) " marker, it is not part of the option.
    text: cellText(cell).replace(/^\d+\)\s*/, ""),
    marked: hasUnderline(cell),
    image_rid: embedIdOf(cell),
  }));
  return { stem_text, stem_image_rid, options };
}

/** The "list" shape (Cau09/Cau10 style): an optional stem image, then exactly 4 ListParagraph options. */
function parseListShape(paras: OrderedNode[]): { stem_text: string; stem_image_rid: string | null; options: ParsedOption[] } {
  let stem_image_rid: string | null = null;
  const stemTexts: string[] = [];
  const options: ParsedOption[] = [];
  for (const p of paras) {
    if (options.length >= TOPIK_OPTION_COUNT) break;
    if (headingStyle(p) === "ListParagraph") {
      options.push({ text: textOf(p).trim(), marked: hasUnderline(p), image_rid: embedIdOf(p) });
      continue;
    }
    const rid = embedIdOf(p);
    if (rid && !stem_image_rid) stem_image_rid = rid;
    const text = textOf(p).trim();
    if (text) stemTexts.push(text);
  }
  return { stem_text: stemTexts.join(" "), stem_image_rid, options };
}

/** Parses one question item starting right after its Heading3 label, consuming until the next heading. */
function parseItem(position: number, labelText: string, body: OrderedNode[], instruction: string | null): ParsedItem {
  // "1-1", "1-9 (36회)", "1-10(36회)" — the number right after the (first) dash.
  const labelMatch = /-\s*(\d+)/.exec(labelText);
  const labelNumber = labelMatch ? Number(labelMatch[1]) : null;
  // "1-9 (36회)" → "36회" (which real exam administration this item is from, if the label says).
  const roundMatch = ROUND_IN_TEXT.exec(labelText);
  const round = roundMatch ? roundMatch[1]! : null;

  // The answer label ("4(4)") is usually the first paragraph under the question's Heading3, but some
  // files repeat the block's instruction line inside each item, either before or after it — so the
  // label is looked up by shape anywhere in the body, not by position.
  const paragraphs = body.filter((n) => tagOf(n) === "w:p");
  const answerPara = paragraphs.find((n) => ANSWER_LABEL.test(textOf(n).trim()));
  const sameSegmentPara = paragraphs.find((n) => SAME_SEGMENT.test(textOf(n).trim()));
  const answerMatch = answerPara ? ANSWER_LABEL.exec(textOf(answerPara).trim()) : null;
  const errors: string[] = [];
  if (!answerMatch) {
    // No label anywhere: report the first paragraph, which is where it should have been.
    const firstText = paragraphs[0] ? textOf(paragraphs[0]).trim() : "";
    errors.push(`answer label not found or malformed (got "${firstText}")`);
  }
  const declared_correct = answerMatch ? Number(answerMatch[2]) : null;
  /** The label, the "same clip" marker and a repeated instruction line are metadata, never part of
   * the stem or an option. */
  const isContent = (n: OrderedNode) =>
    n !== answerPara && n !== sameSegmentPara && !(instruction !== null && textOf(n).trim() === instruction);

  const table = body.find((n) => tagOf(n) === "w:tbl");
  let parsed: { stem_text: string; stem_image_rid: string | null; options: ParsedOption[] };
  if (table) {
    const tableParsed = parseTable(table);
    if (tableParsed.options.length === 0) {
      // A table with only the stem row (no option rows): some files (문항11-12/16-18's "일치하는
      // 내용/중심 생각 고르기" types) put the stem in a 1-row table but the 4 options as plain
      // ListParagraph paragraphs after it instead of more table rows — the same list shape the
      // image-only questions (문항5-8) already use. Reuses `parseListShape` on everything after the
      // table; a stray non-ListParagraph paragraph in between (the file's author's own Vietnamese
      // vocab gloss, e.g. "노소: già trẻ") is simply not ListParagraph-styled, so it is never picked
      // up as an option there — only its (here unused) stem_text/stem_image_rid would absorb it.
      const afterTable = body.slice(body.indexOf(table) + 1).filter((n) => tagOf(n) === "w:p" && isContent(n));
      const listParsed = parseListShape(afterTable);
      parsed = { stem_text: tableParsed.stem_text, stem_image_rid: tableParsed.stem_image_rid, options: listParsed.options };
    } else {
      parsed = tableParsed;
    }
  } else {
    parsed = parseListShape(paragraphs.filter(isContent));
  }

  // Listening questions 1~3 offer four pictures and no words (M7.1). You cannot underline a
  // picture, so for *that shape only* the answer label is the single source of truth. The test is
  // deliberately narrow: one option carrying any text at all puts the question back under the
  // usual rule, because then the underline exists and cross-checking the label is worth keeping.
  const allPictureOptions =
    parsed.options.length === TOPIK_OPTION_COUNT && parsed.options.every((o) => o.image_rid !== null && o.text.trim() === "");

  if (parsed.options.length !== TOPIK_OPTION_COUNT) {
    errors.push(`expected ${TOPIK_OPTION_COUNT} options, found ${parsed.options.length}`);
  } else if (allPictureOptions) {
    // Nothing is assumed here: without a usable label the question is rejected rather than
    // imported with a guessed answer, which would be indistinguishable from a correct one.
    if (declared_correct === null) {
      errors.push(`picture options cannot be underlined, so this question needs an answer label like "2(2)" — none was found`);
    } else if (declared_correct < 1 || declared_correct > TOPIK_OPTION_COUNT) {
      errors.push(`answer label says option ${declared_correct}, which is not between 1 and ${TOPIK_OPTION_COUNT}`);
    }
  } else {
    const markedIndexes = parsed.options.flatMap((o, i) => (o.marked ? [i + 1] : []));
    if (markedIndexes.length !== 1) {
      errors.push(`expected exactly one underlined option, found ${markedIndexes.length} (${markedIndexes.join(",")})`);
    } else if (declared_correct !== null && markedIndexes[0] !== declared_correct) {
      errors.push(`answer label says option ${declared_correct}, but option ${markedIndexes[0]} is underlined`);
    }
  }

  return {
    position,
    labelNumber,
    round,
    instruction,
    same_segment: sameSegmentPara !== undefined,
    stem_text: parsed.stem_text || null,
    stem_image_rid: parsed.stem_image_rid,
    options: parsed.options,
    declared_correct,
    errors,
  };
}

/** Parses `word/document.xml`'s text content into exam groups of questions (no image bytes here). */
export function parseTopikDocument(documentXml: string): ParseDocumentResult {
  const root = parser.parse(documentXml) as OrderedNode[];
  const doc = root.find((n) => tagOf(n) === "w:document");
  const body = doc ? childrenOf(doc).find((n) => tagOf(n) === "w:body") : undefined;
  const top = body ? childrenOf(body) : [];

  let headingBlock: ParseDocumentResult["headingBlock"] = null;
  const warnings: string[] = [];
  const exams: ParsedExam[] = [];
  let currentExam: ParsedExam | null = null;
  let currentInstruction: string | null = null;
  let sawHeading2InCurrentExam = false;

  for (let i = 0; i < top.length; i++) {
    const node = top[i]!;
    if (tagOf(node) !== "w:p") continue;
    const style = headingStyle(node);
    const text = textOf(node).trim();

    if (style === "Heading1") {
      const m = HEADING1_BLOCK.exec(text);
      if (m) headingBlock = { start: Number(m[1]), end: m[2] ? Number(m[2]) : Number(m[1]) };
      continue;
    }
    if (style === "Heading2") {
      // groupIndex is assigned after the walk, once we know which groups hold questions.
      currentExam = { exam: text, groupIndex: 0, round: ROUND_IN_TEXT.exec(text)?.[1] ?? null, items: [] };
      exams.push(currentExam);
      currentInstruction = null;
      sawHeading2InCurrentExam = true;
      continue;
    }
    if (style === "Heading3") {
      if (!currentExam) {
        warnings.push(`question label "${text}" found before any exam heading — skipped`);
        continue;
      }
      // Everything up to (not including) the next heading paragraph belongs to this item.
      const rest: OrderedNode[] = [];
      let j = i + 1;
      for (; j < top.length; j++) {
        const n = top[j]!;
        if (tagOf(n) === "w:p" && /^Heading[123]$/.test(headingStyle(n) ?? "")) break;
        rest.push(n);
      }
      currentExam.items.push(parseItem(currentExam.items.length + 1, text, rest, currentInstruction));
      i = j - 1;
      continue;
    }
    // A plain paragraph right after Heading2 (before the first Heading3) is the instruction.
    if (sawHeading2InCurrentExam && currentExam && currentExam.items.length === 0 && text) {
      currentInstruction = currentInstruction ? `${currentInstruction} ${text}` : text;
    }
  }

  let groupIndex = 0;
  for (const exam of exams) {
    if (exam.items.length === 0) continue;
    exam.groupIndex = ++groupIndex;
  }

  if (!headingBlock) warnings.push('no "문항 N" / "문항 N~M" Heading1 found (block cross-check skipped)');
  return { headingBlock, exams, warnings };
}
