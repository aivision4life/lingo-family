// One-off, read-only (M2.11; TOPIK vocab/explanation added M6.5-ish): lists existing words /
// phrases / examples / TOPIK question vocab+explanations whose LLM-generated text the content
// checks (`worker/services/contentCheck.ts`) would flag — e.g. a stray Latin letter inside a
// Korean sentence, or Vietnamese prose with every diacritic stripped out. Nothing is changed; this
// only prints a list to look at by hand.
//
//   npm run scan-llm-content
//
// Needs `npx wrangler login`. Reaches production through wrangler "remote bindings" (a temporary
// config; nothing in wrangler.jsonc changes), same as scripts/assignCreator.
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import type { LearnLang } from "../../shared/enums";
import { splitUnderline, type TopikVocabEntry } from "../../shared/topik";
import { checkGlosses, checkLangText, checkSentence, checkTopikExplanation, checkTopikVocabEntry } from "../../worker/services/contentCheck";

type Stmt = { bind(...values: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }> };
type D1Like = { prepare(sql: string): Stmt };

const PROD_DB_NAME = "lingo-family";

function tempConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-scan-llm-content-"));
  const file = path.join(dir, "wrangler.jsonc");
  writeFileSync(
    file,
    JSON.stringify({
      name: "lingo-scan-llm-content",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: PROD_DB_NAME, database_id: "10da2bc0-1ba1-4ae2-80be-df43cd5b1931", remote: true }],
    }),
  );
  return file;
}

const rows = async <T>(db: D1Like, sql: string) => (await db.prepare(sql).all<T>()).results;

type Finding = { table: string; id: string; context: string; problems: string[] };

async function scanWords(db: D1Like): Promise<Finding[]> {
  const words = await rows<{ id: string; lang: LearnLang; term: string; gloss_vi: string; gloss_en: string; gloss_ko: string }>(
    db,
    "SELECT id, lang, term, gloss_vi, gloss_en, gloss_ko FROM words",
  );
  return words.flatMap((w) => {
    const allowedWords = w.lang === "en" ? [w.term] : [];
    const problems = [...checkLangText(w.lang, w.term, allowedWords).map((p) => `term: ${p}`), ...checkGlosses(w, allowedWords)];
    return problems.length > 0 ? [{ table: "words", id: w.id, context: `${w.lang} "${w.term}"`, problems }] : [];
  });
}

async function scanPhrases(db: D1Like): Promise<Finding[]> {
  const phrases = await rows<{ id: string; lang: LearnLang; text: string; gloss_vi: string; gloss_en: string; gloss_ko: string }>(
    db,
    "SELECT id, lang, text, gloss_vi, gloss_en, gloss_ko FROM phrases",
  );
  return phrases.flatMap((p) => {
    const allowedWords = p.lang === "en" ? [p.text] : [];
    const problems = [...checkLangText(p.lang, p.text, allowedWords).map((x) => `text: ${x}`), ...checkGlosses(p, allowedWords)];
    return problems.length > 0 ? [{ table: "phrases", id: p.id, context: `${p.lang} "${p.text}"`, problems }] : [];
  });
}

async function scanExamples(db: D1Like): Promise<Finding[]> {
  const examples = await rows<{
    id: string;
    sentence: string;
    translation_vi: string;
    translation_en: string;
    translation_ko: string;
    lang: LearnLang;
    term: string;
  }>(
    db,
    `SELECT e.id, e.sentence, e.translation_vi, e.translation_en, e.translation_ko, w.lang, w.term
     FROM examples e JOIN words w ON w.id = e.word_id`,
  );
  return examples.flatMap((e) => {
    const allowedWords = e.lang === "en" ? [e.term] : [];
    const problems = checkSentence(e.lang, { ...e, image_prompt: "x" }, allowedWords);
    return problems.length > 0 ? [{ table: "examples", id: e.id, context: `${e.lang} "${e.sentence}" (word: ${e.term})`, problems }] : [];
  });
}

/** M6.5-ish: topik_questions' own `vocab` (each entry's `gloss_vi`) and `explanation_vi`. The
 * explanation check's `allowedHangul` includes the stem's own underlined phrase (if any), the same
 * grounding citation `topikExplain.ts#generateTopikExplanationWithCache` allows for real — without
 * it this scan would wrongly flag a correct, expected citation as "unexpected Hangul". */
async function scanTopik(db: D1Like): Promise<Finding[]> {
  const questions = await rows<{
    id: string;
    exam: string;
    number: number;
    stem_text: string | null;
    vocab: string | null;
    explanation_vi: string | null;
    key_terms: string | null;
  }>(db, "SELECT id, exam, number, stem_text, vocab, explanation_vi, key_terms FROM topik_questions");

  const findings: Finding[] = [];
  for (const q of questions) {
    const vocab = (q.vocab ? JSON.parse(q.vocab) : []) as TopikVocabEntry[];
    const context = `${q.exam} #${q.number}`;
    for (const v of vocab) {
      const problems = checkTopikVocabEntry(v);
      if (problems.length > 0) findings.push({ table: "topik_questions.vocab", id: q.id, context: `${context} "${v.surface}"`, problems });
    }
    if (q.explanation_vi) {
      const underlinedPhrases = q.stem_text ? splitUnderline(q.stem_text).filter((r) => r.underlined).map((r) => r.text) : [];
      const allowedHangul = [...new Set([...vocab.flatMap((v) => [v.surface, v.lemma]), ...underlinedPhrases])];
      const key_terms = (q.key_terms ? JSON.parse(q.key_terms) : []) as string[];
      const problems = checkTopikExplanation({ explanation_vi: q.explanation_vi, key_terms }, vocab.map((v) => v.lemma), allowedHangul);
      if (problems.length > 0) findings.push({ table: "topik_questions.explanation_vi", id: q.id, context, problems });
    }
  }
  return findings;
}

async function main() {
  const configPath = tempConfig();
  const proxy = await getPlatformProxy({ configPath, remoteBindings: true });
  try {
    const db = proxy.env.DB as unknown as D1Like;
    const findings = [...(await scanWords(db)), ...(await scanPhrases(db)), ...(await scanExamples(db)), ...(await scanTopik(db))];

    console.log(`Scanned words, phrases and examples in production D1 "${PROD_DB_NAME}". Nothing was changed.\n`);
    if (findings.length === 0) {
      console.log("No suspicious content found.");
      return;
    }
    console.log(`${findings.length} suspicious row(s):\n`);
    for (const f of findings) console.log(`  [${f.table}] ${f.id} — ${f.context}\n    ${f.problems.join("\n    ")}`);
  } finally {
    await proxy.dispose();
  }
}

await main();
