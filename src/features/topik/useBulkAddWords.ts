// "Thêm tất cả vào thư viện" (M6.3): runs the normal full enrichment (Hanja, all 3 glosses, example
// sentences, image, FSRS card) for each marked term in turn, with no per-word review screen — the
// user already reviewed these implicitly by marking them during practice. Sequential (not
// parallel), so hitting the daily LLM/image quota mid-run stops cleanly instead of firing several
// calls that would all fail at once; whichever terms never got to run stay reported as "skipped"
// so the user can retry them later (e.g. from the normal Add-word screen).
import { useState } from "react";
import type { ExampleLevel, LearnLang } from "@shared/enums";
import { WORD_ERRORS } from "@shared/word";
import { ApiError } from "@/lib/api";
import { draftFromEnrichment, draftToCreateInput } from "@/features/words/draft";
import { useCreateWord, useEnrichWord } from "@/features/words/api";

export type BulkAddStatus = "pending" | "running" | "done" | "error" | "skipped";
export type BulkAddItem = { lemma: string; status: BulkAddStatus; errorCode?: string; wordId?: string };

export function useBulkAddWords(profileId: string, lang: LearnLang, level: ExampleLevel) {
  const enrich = useEnrichWord();
  const create = useCreateWord();
  const [items, setItems] = useState<BulkAddItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const run = async (lemmas: string[]): Promise<{ addedLemmas: string[] }> => {
    if (isRunning || lemmas.length === 0) return { addedLemmas: [] };
    setIsRunning(true);
    setItems(lemmas.map((lemma) => ({ lemma, status: "pending" })));
    const setItem = (lemma: string, patch: Partial<BulkAddItem>) =>
      setItems((prev) => prev.map((i) => (i.lemma === lemma ? { ...i, ...patch } : i)));

    const added: string[] = [];
    let quotaHit = false;
    for (const lemma of lemmas) {
      if (quotaHit) {
        setItem(lemma, { status: "skipped" });
        continue;
      }
      setItem(lemma, { status: "running" });
      try {
        const enrichRes = await enrich.mutateAsync({ profile_id: profileId, lang, term: lemma, level });
        const draft = draftFromEnrichment(enrichRes.enrichment);
        const { input } = draftToCreateInput(draft, { profileId, lang, term: lemma, level, aiFilled: true });
        if (!input) {
          setItem(lemma, { status: "error", errorCode: "invalid" });
          continue;
        }
        const created = await create.mutateAsync({ ...input, phrases: [], album_ids: [] });
        setItem(lemma, { status: "done", wordId: created.id });
        added.push(lemma);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "unknown";
        setItem(lemma, { status: "error", errorCode: code });
        if (code === WORD_ERRORS.quotaExceeded) quotaHit = true;
      }
    }
    setIsRunning(false);
    return { addedLemmas: added };
  };

  return { items, run, isRunning };
}
