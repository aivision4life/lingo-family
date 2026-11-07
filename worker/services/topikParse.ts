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

/**
 * True when a run **with actual text** under `node` is underlined — the convention that marks the
 * correct option.
 *
 * Only a run counts (M7.10). A paragraph carries its own end-of-paragraph mark, whose formatting
 * lives in `<w:pPr><w:rPr>`, and Word stores an underline there as readily as on real text —
 * invisible on screen, since there is nothing to draw a line under. Walking the whole subtree
 * therefore reported every option of a question as underlined: measured on 36회 #5, option 1 had
 * 10 underlined runs and options 2-4 had none, yet all four carried that invisible mark.
 *
 * A run of only spaces does not count either: the underline under a trailing space is not a mark
 * anyone made on purpose.
 */
function hasUnderline(node: OrderedNode): boolean {
  if (tagOf(node) === "w:r") return runIsUnderlined(node);
  return childrenOf(node).some(hasUnderline);
}

/** Underlined, and carrying text that is not just whitespace. */
function runIsUnderlined(run: OrderedNode): boolean {
  if (textOf(run).trim() === "") return false;
  const properties = childrenOf(run).find((c) => tagOf(c) === "w:rPr");
  if (!properties) return false;
  return childrenOf(properties).some((c) => tagOf(c) === "w:u" && attrsOf(c)["@_w:val"] !== "none");
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
   * A Heading3 label that is nothing but a number ("37"), which is how a whole-paper file numbers
   * its questions (M7.16). Kept apart from `labelNumber` because the two mean different things: a
   * block file's "1-9" is the ninth question *of a practice group*, while this is the question's
   * own number in the paper, and reading one as the other would renumber a whole exam.
   */
  paperNumber: number | null;
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
  /**
   * This question's own question line ("HỎI: …"), kept apart from the block's line so a whole-paper
   * file can pair it with the right block (M7.16) — in those files the block line sits *between*
   * two questions, so the one it is parsed with is not the one it belongs to.
   */
  own_instruction: string | null;
  /**
   * A block instruction ("[3~4] …") this question carried itself, when the file starts a new block
   * part way through a group instead of between the heading and the first question. It applies to
   * this question and to the rest of the group, which is what the "[3~4]" in it says.
   */
  block_instruction: string | null;
  stem_text: string | null;
  stem_image_rid: string | null;
  options: ParsedOption[];
  /** The 1-based option the answer label declares correct (null when the label itself is malformed). */
  declared_correct: number | null;
  errors: string[];
  /** Worth a human's eye but not a reason to reject the question (e.g. the underline disagrees). */
  warnings: string[];
  /**
   * Paragraphs inside this question that nothing used, verbatim (M7.3).
   *
   * The parser must never throw content away without saying so. Three separate losses of typed-up
   * work went unnoticed because it did exactly that (a stem cell split in two, an image path
   * missing its `word/` prefix, and a per-question question line), so anything unaccounted for is
   * collected here and the caller turns it into a hard error.
   */
  ignored: IgnoredParagraph[];
};

/**
 * A paragraph inside a question that nothing used.
 *
 * `after_options` separates the two very different cases. Before or between the question's own
 * parts, a stray paragraph is content that was meant to be read and is being lost — that is how a
 * per-question question line disappeared. After the four options is the file author's own note
 * area (Vietnamese vocabulary glosses, "관람료: phí, tiền vé"), which is deliberately not part of
 * the question; it is still reported, never dropped in silence, but it does not reject the
 * question.
 */
export type IgnoredParagraph = { text: string; after_options: boolean };

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
/**
 * This question's own question line (M7.3): "HỎI: 남자의 중심 생각으로 맞는 것을 고르십시오."
 *
 * From question 21 on, one clip is followed by two questions that ask different things, so the
 * block-wide instruction ("[21~22] 다음을 듣고 물음에 답하십시오. (각 2점)") is no longer the whole
 * prompt. It cannot go in the stem cell — that cell is the transcript and is hidden while the
 * question is being answered — so it is its own marked paragraph, like `CHUNG ĐOẠN`.
 */
const OWN_INSTRUCTION = /^(hỏi|hoi)\s*:\s*(.+)$/is;
/**
 * A block instruction, "[3~4] 다음 밑줄 친 부분과…". It normally sits between the group heading and
 * the first question, but a file can leave the group without one and type it inside a question
 * instead (Cau03_04_MasterTopik 연습6 #3). Recognising the shape lets that line be *used* as the
 * question's instruction rather than silently dropped, which is what happened until M7.3 — the
 * reading import only hid it by overriding the instruction per question number.
 */
const BLOCK_INSTRUCTION = /^\[\s*\d+\s*(~\s*\d+)?\s*\]/;
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

/**
 * The "list" shape (Cau09/Cau10 style): an optional stem image, then exactly 4 ListParagraph
 * options. `trailing` holds the paragraphs that came after the four options — the file's author
 * sometimes writes a Vietnamese vocabulary note there, and it must not become a fifth option.
 */
function parseListShape(paras: OrderedNode[]): {
  stem_text: string;
  stem_image_rid: string | null;
  options: ParsedOption[];
  trailing: OrderedNode[];
  /** The stem paragraphs as separate lines; `stem_text` joins them and loses the boundaries. */
  stem_lines: string[];
} {
  let stem_image_rid: string | null = null;
  const stemTexts: string[] = [];
  const options: ParsedOption[] = [];
  const trailing: OrderedNode[] = [];
  for (const p of paras) {
    if (options.length >= TOPIK_OPTION_COUNT) {
      if (textOf(p).trim() !== "" || embedIdOf(p) !== null) trailing.push(p);
      continue;
    }
    if (headingStyle(p) === "ListParagraph") {
      options.push({ text: textOf(p).trim(), marked: hasUnderline(p), image_rid: embedIdOf(p) });
      continue;
    }
    const rid = embedIdOf(p);
    if (rid && !stem_image_rid) stem_image_rid = rid;
    const text = textOf(p).trim();
    if (text) stemTexts.push(text);
  }
  return { stem_text: stemTexts.join(" "), stem_image_rid, options, trailing, stem_lines: stemTexts };
}

/**
 * A paragraph that reads like an exam instruction rather than like the recording: it ends in the
 * polite imperative the instructions are written in (고르십시오, 답하십시오, 쓰십시오, …).
 *
 * This is the one way a question line can still be lost (M7.3). In the listening layout the
 * transcript is plain paragraphs, so a question line typed without its `HỎI: ` prefix is
 * indistinguishable from a line of the recording — it is simply absorbed into the transcript,
 * which the server withholds while the question is being answered. Nothing can be refused over it:
 * a speaker really can say "안녕히 계십시오". So it is a warning, and a line that opens with a
 * speaker marker ("남자 : …") is not even that.
 *
 * It matches the handful of verbs the instructions themselves use, not every polite imperative:
 * questions 5-8 of the reading section quote notices and medicine labels full of "복용하지
 * 마십시오" / "냉장고에 두십시오", and the broad rule flagged 11 of them — every one a false alarm,
 * and every one would have been written into that question's warning field for good.
 */
const POLITE_IMPERATIVE = /(고르|답하|쓰|완성하|서술하|작성하)십시오[.。]?$/;
const SPEAKER_PREFIX = /^[^:：]{1,12}[:：]/;

export function commandLikeStemLines(lines: readonly string[]): string[] {
  return lines.map((l) => l.trim()).filter((l) => POLITE_IMPERATIVE.test(l) && !SPEAKER_PREFIX.test(l));
}

/** Parses one question item starting right after its Heading3 label, consuming until the next heading. */
function parseItem(position: number, labelText: string, body: OrderedNode[], instruction: string | null): ParsedItem {
  // "1-1", "1-9 (36회)", "1-10(36회)" — the number right after the (first) dash.
  const labelMatch = /-\s*(\d+)/.exec(labelText);
  const labelNumber = labelMatch ? Number(labelMatch[1]) : null;
  // "37" on its own: a whole paper's questions are labelled by their real number.
  const bare = /^\s*(\d+)\s*$/.exec(labelText);
  const paperNumber = bare ? Number(bare[1]) : null;
  // "1-9 (36회)" → "36회" (which real exam administration this item is from, if the label says).
  const roundMatch = ROUND_IN_TEXT.exec(labelText);
  const round = roundMatch ? roundMatch[1]! : null;

  // The answer label ("4(4)") is usually the first paragraph under the question's Heading3, but some
  // files repeat the block's instruction line inside each item, either before or after it — so the
  // label is looked up by shape anywhere in the body, not by position.
  const paragraphs = body.filter((n) => tagOf(n) === "w:p");
  const answerPara = paragraphs.find((n) => ANSWER_LABEL.test(textOf(n).trim()));
  const sameSegmentPara = paragraphs.find((n) => SAME_SEGMENT.test(textOf(n).trim()));
  // This question's own question line, which is appended to the group's instruction.
  const ownInstructionPara = paragraphs.find((n) => OWN_INSTRUCTION.test(textOf(n).trim()));
  const ownInstruction = ownInstructionPara ? OWN_INSTRUCTION.exec(textOf(ownInstructionPara).trim())![2]!.trim() : null;
  // A block instruction typed inside the question, used only when the group has none of its own.
  const strayBlockPara = paragraphs.find((n) => BLOCK_INSTRUCTION.test(textOf(n).trim()));
  const blockInstruction = strayBlockPara ? textOf(strayBlockPara).trim() : null;
  const groupInstruction = blockInstruction ?? instruction;
  const answerMatch = answerPara ? ANSWER_LABEL.exec(textOf(answerPara).trim()) : null;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!answerMatch) {
    // No label anywhere: report the first paragraph, which is where it should have been.
    const firstText = paragraphs[0] ? textOf(paragraphs[0]).trim() : "";
    errors.push(`answer label not found or malformed (got "${firstText}")`);
  }
  const declared_correct = answerMatch ? Number(answerMatch[2]) : null;
  /** The label, the "same clip" marker and a repeated instruction line are metadata, never part of
   * the stem or an option. */
  const isContent = (n: OrderedNode) =>
    n !== answerPara &&
    n !== sameSegmentPara &&
    n !== ownInstructionPara &&
    n !== strayBlockPara &&
    !(instruction !== null && textOf(n).trim() === instruction);

  const table = body.find((n) => tagOf(n) === "w:tbl");
  /** Paragraphs no part of the question used, with where they sat relative to the options. */
  const unused: { node: OrderedNode; after_options: boolean }[] = [];
  const before = (nodes: OrderedNode[]) => nodes.map((node) => ({ node, after_options: false }));
  const after = (nodes: OrderedNode[]) => nodes.map((node) => ({ node, after_options: true }));
  let parsed: { stem_text: string; stem_image_rid: string | null; options: ParsedOption[] };
  let stemLines: string[];
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
      stemLines = tableParsed.stem_text.split("\n");
      // Anything before the table, and anything between or after the options, went nowhere: the
      // stem came from the table and only ListParagraphs became options.
      const beforeTable = body.slice(0, body.indexOf(table)).filter((n) => tagOf(n) === "w:p" && isContent(n));
      const lastOption = afterTable.map((n) => headingStyle(n)).lastIndexOf("ListParagraph");
      const strays = afterTable.filter((n) => headingStyle(n) !== "ListParagraph");
      unused.push(
        ...before(beforeTable),
        ...before(strays.filter((n) => afterTable.indexOf(n) < lastOption)),
        ...after(strays.filter((n) => afterTable.indexOf(n) > lastOption)),
      );
    } else {
      parsed = tableParsed;
      stemLines = tableParsed.stem_text.split("\n");
      // Every paragraph of a table question is unused by definition: the stem and all four
      // options come from the table's own cells. "After the options" here means after the table.
      const tableAt = body.indexOf(table);
      unused.push(
        ...before(body.slice(0, tableAt).filter((n) => tagOf(n) === "w:p" && isContent(n))),
        ...after(body.slice(tableAt + 1).filter((n) => tagOf(n) === "w:p" && isContent(n))),
      );
    }
  } else {
    const listParsed = parseListShape(paragraphs.filter(isContent));
    parsed = listParsed;
    stemLines = listParsed.stem_lines;
    unused.push(...after(listParsed.trailing));
  }

  // One rule for both sections (M7.9): the "N(N)" label **is** the answer, and the underline is
  // only read back to it. Reading used to treat the underline as authoritative and refuse the
  // question when the two disagreed, which meant a stray underline — formatting bleed from a
  // paper typed up out of a PDF — threw away a question whose answer was perfectly legible.
  // Nothing is guessed, though: with no label there is no answer, and that stays a hard error.
  const markedIndexes = parsed.options.flatMap((o, i) => (o.marked ? [i + 1] : []));
  /** Four pictures cannot carry an underline, so their having none is the shape, not a problem. */
  const allPictureOptions =
    parsed.options.length === TOPIK_OPTION_COUNT && parsed.options.every((o) => o.image_rid !== null && o.text.trim() === "");

  if (parsed.options.length !== TOPIK_OPTION_COUNT) {
    errors.push(`expected ${TOPIK_OPTION_COUNT} options, found ${parsed.options.length}`);
  } else if (declared_correct === null) {
    errors.push(`no answer label like "2(2)" was found; the answer is never guessed from the underline`);
  } else if (declared_correct < 1 || declared_correct > TOPIK_OPTION_COUNT) {
    errors.push(`answer label says option ${declared_correct}, which is not between 1 and ${TOPIK_OPTION_COUNT}`);
  } else if (markedIndexes.length === 1 && markedIndexes[0] !== declared_correct) {
    warnings.push(`answer label says option ${declared_correct}, but option ${markedIndexes[0]} is underlined (the label was used)`);
  } else if (markedIndexes.length > 1) {
    warnings.push(
      `answer label says option ${declared_correct}, but ${markedIndexes.length} options are underlined (${markedIndexes.join(", ")}) (the label was used)`,
    );
  } else if (markedIndexes.length === 0 && !allPictureOptions) {
    warnings.push(`answer label says option ${declared_correct}, but no option is underlined (the label was used)`);
  }

  // The stem's own lines: a table cell joins its paragraphs with a newline, the list shape keeps
  // them separately (see `parseListShape`).
  for (const line of commandLikeStemLines(stemLines)) {
    warnings.push(`a line of the stem reads like an instruction; if it is this question's question line, prefix it with "HỎI: ": "${line}"`);
  }

  const ignored = unused
    .map(({ node, after_options }) => ({ text: textOf(node).trim(), after_options }))
    .filter((p) => p.text !== "");

  return {
    position,
    labelNumber,
    paperNumber,
    round,
    // The group's line first, then this question's own: "[21~22] 다음을 듣고… (각 2점)" still holds
    // the points, and the question line is what actually has to be read before answering.
    instruction: ownInstruction ? [groupInstruction, ownInstruction].filter((x) => x).join("\n") : groupInstruction,
    own_instruction: ownInstruction,
    same_segment: sameSegmentPara !== undefined,
    block_instruction: blockInstruction,
    stem_text: parsed.stem_text || null,
    stem_image_rid: parsed.stem_image_rid,
    options: parsed.options,
    declared_correct,
    errors,
    warnings,
    ignored,
  };
}

/**
 * A question marked `CHUNG ĐOẠN` is asked about the clip the one before it already carries, so it
 * is the same recording and therefore the same transcript. Rather than have it typed twice — two
 * copies nothing compares, which drift the first time one of them is corrected — the stem cell is
 * left empty and the transcript is taken from the question before.
 *
 * A second question that does have its own stem keeps it, but a stem that differs from the one it
 * shares a clip with is a contradiction worth reading: one recording cannot have two transcripts.
 */
function inheritStem(item: ParsedItem, previous: ParsedItem | undefined): void {
  if (!item.same_segment || !previous) return;
  if (item.stem_text === null) {
    item.stem_text = previous.stem_text;
    return;
  }
  if (previous.stem_text !== null && item.stem_text !== previous.stem_text) {
    item.warnings.push("marked CHUNG ĐOẠN but its stem differs from the question it shares the clip with (its own is used)");
  }
}

/** Parses `word/document.xml`'s text content into exam groups of questions (no image bytes here). */
/**
 * Since M7.9 nothing in the parse depends on which section the paper is: the "N(N)" label is the
 * answer in both, and the underline is only compared against it. The parameter is gone rather than
 * kept and ignored — a signature that still asks for something it does not use is a lie the next
 * reader has to disprove.
 */
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
      const item = parseItem(currentExam.items.length + 1, text, rest, currentInstruction);
      inheritStem(item, currentExam.items[currentExam.items.length - 1]);
      currentExam.items.push(item);
      // "[3~4] …" typed inside question 3 of a group headed "[1~2] …" starts a new block there,
      // so it is this question's instruction and the following ones' too — until M7.3 it was
      // dropped on the floor, and only the reading import's per-number override hid the loss.
      if (item.block_instruction) currentInstruction = item.block_instruction;
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
