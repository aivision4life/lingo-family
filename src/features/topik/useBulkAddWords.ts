// "Thêm tất cả vào thư viện" (M6.3): runs the normal full enrichment (Hanja, all 3 glosses, example
// sentences, image, FSRS card) for each marked term in turn, with no per-word review screen — the
// user already reviewed these implicitly by marking them during practice. Sequential (not
// parallel), so hitting the daily LLM/image quota mid-run stops cleanly instead of firing several
// calls that would all fail at once; whichever terms never got to run stay reported as "skipped"
// so the user can retry them later (e.g. from the normal Add-word screen).
//
// M7.12: every term also joins the album of the section it was met in ("TOPIK II Reading" /
// "TOPIK II Listening"), created on first use. A term that is already in the library is **not**
// created again and costs no AI call — the existing word simply joins the album, which is the
// point: an album is a playlist, and a word belongs in several.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ExampleLevel, LearnLang, TopikSection } from "@shared/enums";
import { TOPIK_ALBUM } from "@shared/topik";
import { WORD_ERRORS } from "@shared/word";
import { ApiError } from "@/lib/api";
import { duplicateAlbumIdOf, useAddToAlbum, useCreateAlbum } from "@/features/albums/api";
import { draftFromEnrichment, draftToCreateInput } from "@/features/words/draft";
import { lookupWord, useCreateWord, useEnrichWord } from "@/features/words/api";
import type { MarkedTerm } from "./markedWords";

export type BulkAddStatus = "pending" | "running" | "done" | "error" | "skipped";
export type BulkAddItem = { lemma: string; status: BulkAddStatus; errorCode?: string; wordId?: string };

export function useBulkAddWords(profileId: string, lang: LearnLang, level: ExampleLevel) {
  const enrich = useEnrichWord();
  const create = useCreateWord();
  const createAlbum = useCreateAlbum();
  const addToAlbum = useAddToAlbum();
  const qc = useQueryClient();
  const [items, setItems] = useState<BulkAddItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  /** The album's id, creating it the first time a section needs one. A 409 means another profile
   * (or an earlier session) already made it, and its id comes back with the error. */
  const ensureAlbum = async (section: TopikSection): Promise<string> => {
    try {
      const created = await createAlbum.mutateAsync({ profileId, name: TOPIK_ALBUM[section], lang });
      return created.id;
    } catch (e) {
      const existing = duplicateAlbumIdOf(e);
      if (existing === null) throw e;
      return existing;
    }
  };

  const run = async (terms: MarkedTerm[]): Promise<{ addedLemmas: string[] }> => {
    if (isRunning || terms.length === 0) return { addedLemmas: [] };
    setIsRunning(true);
    setItems(terms.map((term) => ({ lemma: term.lemma, status: "pending" })));
    const setItem = (lemma: string, patch: Partial<BulkAddItem>) =>
      setItems((prev) => prev.map((i) => (i.lemma === lemma ? { ...i, ...patch } : i)));

    const added: string[] = [];
    const albums = new Map<TopikSection, string>();
    let quotaHit = false;
    for (const term of terms) {
      if (quotaHit) {
        setItem(term.lemma, { status: "skipped" });
        continue;
      }
      setItem(term.lemma, { status: "running" });
      try {
        const section = term.source.section;
        const albumId = albums.get(section) ?? (await ensureAlbum(section));
        albums.set(section, albumId);

        // Already in the library: no second word, no AI call, just the album. Adding a word the
        // album already holds is a no-op server side, so marking a term twice cannot fail.
        const existing = await lookupWord(lang, term.lemma);
        if (existing) {
          await addToAlbum.mutateAsync({ profileId, albumId, wordIds: [existing.id] });
          setItem(term.lemma, { status: "done", wordId: existing.id });
          added.push(term.lemma);
          continue;
        }

        // A word met in a TOPIK question is studied for that exam, so its example sentences are
        // written the way the exam writes (M7.12) — not "tôi ăn cơm".
        const enrichRes = await enrich.mutateAsync({ profile_id: profileId, lang, term: term.lemma, level, style: "topik" });
        const draft = draftFromEnrichment(enrichRes.enrichment);
        const { input } = draftToCreateInput(draft, { profileId, lang, term: term.lemma, level, aiFilled: true });
        if (!input) {
          setItem(term.lemma, { status: "error", errorCode: "invalid" });
          continue;
        }
        const created = await create.mutateAsync({ ...input, phrases: [], album_ids: [albumId], topik_sources: [term.source] });
        setItem(term.lemma, { status: "done", wordId: created.id });
        added.push(term.lemma);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "unknown";
        setItem(term.lemma, { status: "error", errorCode: code });
        if (code === WORD_ERRORS.quotaExceeded) quotaHit = true;
      }
    }
    // A word created with `album_ids` never passed through the album mutations, so the album grid
    // and its counts would otherwise still show the state from before the run.
    if (albums.size > 0) await qc.invalidateQueries({ queryKey: ["albums"] });
    setIsRunning(false);
    return { addedLemmas: added };
  };

  return { items, run, isRunning };
}
