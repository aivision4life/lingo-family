// Pure planning for "move local content to production" (M2.1, option "B reduced").
//
// Content only: words, phrases, examples, han_chars, word_chars, ai_cache. Never profiles,
// deck links, cards, review logs or usage. Production always wins: a local row whose natural
// key already exists in production is skipped and logged, and its children are re-parented
// onto the production row so ids stay consistent. Re-running finds everything present and
// plans nothing (idempotent).
import { duplicateKey } from "../../shared/base";
import type { LearnLang } from "../../shared/enums";

export type Row = Record<string, unknown>;

export type LocalContent = {
  words: Row[];
  phrases: Row[];
  examples: Row[];
  han_chars: Row[];
  word_chars: Row[];
  ai_cache: Row[];
};

/** What production already has (only what planning needs). */
export type RemoteContent = {
  words: { id: string; lang: LearnLang; term: string }[];
  phrases: { id: string; lang: LearnLang; text: string }[];
  exampleIds: string[];
  hanjas: string[];
  /** "word_id:position" */
  wordCharKeys: string[];
  aiCacheKeys: string[];
};

export type Skip = { table: string; label: string; reason: string };

export type Plan = {
  words: Row[];
  phrases: Row[];
  examples: Row[];
  han_chars: Row[];
  word_chars: Row[];
  ai_cache: Row[];
  /** Everything left out, with the reason (shown in the dry run). */
  skipped: Skip[];
  /** Words in local order with their outcome, for the dry-run list. */
  wordStatus: { lang: string; term: string; status: "new" | "exists-in-production" | "already-migrated" }[];
};

const str = (r: Row, k: string) => String(r[k] ?? "");

/** Reference to a profile → NULL (profiles are not moved). */
const noProfile = (r: Row): Row => ({ ...r, created_by_profile: null });

type Target = {
  /** Id of the row in production after this run. */
  id: string;
  /** Inserted by this run. */
  isNew: boolean;
  /** Production already has this very row (same id): moved by an earlier run. */
  sameRow: boolean;
};

export function planContent(local: LocalContent, remote: RemoteContent, newId: () => string = () => crypto.randomUUID()): Plan {
  const plan: Plan = { words: [], phrases: [], examples: [], han_chars: [], word_chars: [], ai_cache: [], skipped: [], wordStatus: [] };
  const skip = (table: string, label: string, reason: string) => plan.skipped.push({ table, label, reason });

  const remoteWordByKey = new Map(remote.words.map((w) => [`${w.lang}|${duplicateKey(w.lang, w.term)}`, w.id]));
  const remotePhraseByKey = new Map(remote.phrases.map((p) => [`${p.lang}|${duplicateKey(p.lang, p.text)}`, p.id]));
  const usedWordIds = new Set(remote.words.map((w) => w.id));
  const usedPhraseIds = new Set(remote.phrases.map((p) => p.id));
  const usedExampleIds = new Set(remote.exampleIds);

  // --- words -----------------------------------------------------------------------------
  const wordTarget = new Map<string, Target>();
  const seenWordKeys = new Set<string>();
  for (const w of local.words) {
    const id = str(w, "id");
    const lang = str(w, "lang") as LearnLang;
    const key = `${lang}|${duplicateKey(lang, str(w, "term"))}`;
    const label = `${lang} ${str(w, "term")}`;
    const existing = remoteWordByKey.get(key);
    if (existing !== undefined || seenWordKeys.has(key)) {
      const target = existing ?? id;
      wordTarget.set(id, { id: target, isNew: false, sameRow: target === id });
      const same = target === id;
      plan.wordStatus.push({ lang, term: str(w, "term"), status: same ? "already-migrated" : "exists-in-production" });
      if (!same) skip("words", label, "same language + term exists in production (production kept)");
      continue;
    }
    seenWordKeys.add(key);
    const targetId = usedWordIds.has(id) ? newId() : id;
    usedWordIds.add(targetId);
    wordTarget.set(id, { id: targetId, isNew: true, sameRow: false });
    plan.words.push({ ...noProfile(w), id: targetId });
    plan.wordStatus.push({ lang, term: str(w, "term"), status: "new" });
  }

  // --- phrases ---------------------------------------------------------------------------
  const phraseTarget = new Map<string, Target>();
  const seenPhraseKeys = new Set<string>();
  for (const p of local.phrases) {
    const id = str(p, "id");
    const root = wordTarget.get(str(p, "word_id"));
    if (!root) continue; // root word missing from the local export (cannot happen with foreign keys on)
    const lang = str(p, "lang") as LearnLang;
    const key = `${lang}|${duplicateKey(lang, str(p, "text"))}`;
    const label = `${lang} ${str(p, "text")}`;
    const existing = remotePhraseByKey.get(key);
    if (existing !== undefined || seenPhraseKeys.has(key)) {
      const target = existing ?? id;
      phraseTarget.set(id, { id: target, isNew: false, sameRow: target === id });
      if (target !== id) skip("phrases", label, "same language + text exists in production (production kept)");
      continue;
    }
    seenPhraseKeys.add(key);
    const targetId = usedPhraseIds.has(id) ? newId() : id;
    usedPhraseIds.add(targetId);
    phraseTarget.set(id, { id: targetId, isNew: true, sameRow: false });
    // A new phrase under a word that production already had is attached to the production word.
    plan.phrases.push({ ...noProfile(p), id: targetId, word_id: root.id });
  }

  // --- examples: they follow their owner (the phrase, else the word) -------------------------
  for (const e of local.examples) {
    const id = str(e, "id");
    const phraseLocal = e.phrase_id === null || e.phrase_id === undefined ? null : str(e, "phrase_id");
    const root = wordTarget.get(str(e, "word_id"));
    const ownerPhrase = phraseLocal === null ? null : phraseTarget.get(phraseLocal);
    const owner = phraseLocal === null ? root : ownerPhrase;
    const label = `"${str(e, "sentence").slice(0, 30)}"`;
    if (!root || !owner) continue;
    // Insert when the owner is new, or when it was moved by an earlier run and this example is missing.
    const wanted = owner.isNew || (owner.sameRow && !usedExampleIds.has(id));
    if (!wanted) {
      skip("examples", label, owner.sameRow ? "already in production" : "its word/phrase exists in production (production examples kept)");
      continue;
    }
    const targetId = usedExampleIds.has(id) ? newId() : id;
    usedExampleIds.add(targetId);
    plan.examples.push({ ...e, id: targetId, word_id: root.id, phrase_id: ownerPhrase ? ownerPhrase.id : null });
  }

  // --- Hanja tables ------------------------------------------------------------------------
  const haveHanja = new Set(remote.hanjas);
  for (const h of local.han_chars) {
    const hanja = str(h, "hanja");
    if (haveHanja.has(hanja)) skip("han_chars", hanja, "already in production");
    else {
      haveHanja.add(hanja);
      plan.han_chars.push(h);
    }
  }
  const haveWordChar = new Set(remote.wordCharKeys);
  for (const c of local.word_chars) {
    const root = wordTarget.get(str(c, "word_id"));
    if (!root) continue;
    const k = `${root.id}:${str(c, "position")}`;
    const wanted = root.isNew || (root.sameRow && !haveWordChar.has(k));
    if (!wanted) {
      skip("word_chars", k, "its word exists in production");
      continue;
    }
    haveWordChar.add(k);
    plan.word_chars.push({ ...c, word_id: root.id });
  }

  // --- AI cache: production keeps its entries ----------------------------------------------
  const haveCache = new Set(remote.aiCacheKeys);
  for (const row of local.ai_cache) {
    const key = str(row, "key");
    if (haveCache.has(key)) skip("ai_cache", key.slice(0, 12), "already in production");
    else {
      haveCache.add(key);
      plan.ai_cache.push(row);
    }
  }
  return plan;
}

export const countByTable = (p: Plan) => ({
  words: p.words.length,
  phrases: p.phrases.length,
  examples: p.examples.length,
  han_chars: p.han_chars.length,
  word_chars: p.word_chars.length,
  ai_cache: p.ai_cache.length,
});
