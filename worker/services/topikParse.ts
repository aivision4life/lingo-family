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
  stem_text: string | null;
  stem_image_rid: string | null;
  options: ParsedOption[];
  /** The 1-based option the answer label declares correct (null when the label itself is malformed). */
  declared_correct: number | null;
  errors: string[];
};

/** `groupIndex` is a plain 1-based counter of Heading2 groups in the file, independent of the
 * group's own heading text (which varies a lot: "Yonsei-연습1", "연습1 (35회)", "연습1: Official"). */
export type ParsedExam = { exam: string; groupIndex: number; items: ParsedItem[] };

export type ParseDocumentResult = {
  /** [start, end] parsed from the Heading1 text, when found (cross-check only; the caller trusts the file name). */
  headingBlock: { start: number; end: number } | null;
  exams: ParsedExam[];
  /** File-level problems that are not tied to one question (e.g. no Heading1 found at all). */
  warnings: string[];
};

const ANSWER_LABEL = /^(\d+)\s*\((\d+)\)$/;
/** "유형1: 문항 1~2" / "문항 9" — the block is always the trailing number(s). */
const HEADING1_BLOCK = /(\d+)\s*(?:~\s*(\d+))?\s*$/;

function parseTable(tbl: OrderedNode): { stem_text: string; stem_image_rid: string | null; options: ParsedOption[] } {
  const rows = childrenOf(tbl).filter((c) => tagOf(c) === "w:tr");
  const cellsOf = (row: OrderedNode) => childrenOf(row).filter((c) => tagOf(c) === "w:tc");
  const stemRow = rows[0];
  const stemCell = stemRow ? cellsOf(stemRow)[0] : undefined;
  const stem_text = stemCell ? textOf(stemCell).trim() : "";
  const stem_image_rid = stemCell ? embedIdOf(stemCell) : null;

  const optionCells = rows.slice(1).flatMap(cellsOf);
  const options: ParsedOption[] = optionCells.slice(0, TOPIK_OPTION_COUNT).map((cell) => ({
    // Cell text is "1) 일어나는데" etc.; drop the leading "N) " marker, it is not part of the option.
    text: textOf(cell).trim().replace(/^\d+\)\s*/, ""),
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
  const roundMatch = /\((\d+회)\)/.exec(labelText);
  const round = roundMatch ? roundMatch[1]! : null;

  const answerPara = body.find((n) => tagOf(n) === "w:p");
  const answerText = answerPara ? textOf(answerPara).trim() : "";
  const answerMatch = ANSWER_LABEL.exec(answerText);
  const errors: string[] = [];
  if (!answerMatch) errors.push(`answer label not found or malformed (got "${answerText}")`);
  const declared_correct = answerMatch ? Number(answerMatch[2]) : null;

  const table = body.find((n) => tagOf(n) === "w:tbl");
  const parsed = table
    ? parseTable(table)
    : parseListShape(body.filter((n) => tagOf(n) === "w:p" && n !== answerPara));

  if (parsed.options.length !== TOPIK_OPTION_COUNT) {
    errors.push(`expected ${TOPIK_OPTION_COUNT} options, found ${parsed.options.length}`);
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
      currentExam = { exam: text, groupIndex: exams.length + 1, items: [] };
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

  if (!headingBlock) warnings.push('no "문항 N" / "문항 N~M" Heading1 found (block cross-check skipped)');
  return { headingBlock, exams, warnings };
}
