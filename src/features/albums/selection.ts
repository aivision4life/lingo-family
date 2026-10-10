// "Select many" in the Library and on album pages: a set of selected word ids. Pure helpers.
export type Selection = ReadonlySet<string>;

export const emptySelection: Selection = new Set();

export function toggle(selection: Selection, id: string): Selection {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export const selectAll = (ids: readonly string[]): Selection => new Set(ids);

/** Keeps only ids that are still shown (the list can change under a selection: search, refresh). */
export function prune(selection: Selection, visibleIds: readonly string[]): Selection {
  const visible = new Set(visibleIds);
  const kept = [...selection].filter((id) => visible.has(id));
  return kept.length === selection.size ? selection : new Set(kept);
}

/** Selected words must share a language to go into an album; returns it, or null when mixed / empty. */
export function selectionLang<T extends { id: string; lang: string }>(selection: Selection, words: readonly T[]): T["lang"] | null {
  const langs = new Set(words.filter((w) => selection.has(w.id)).map((w) => w.lang));
  return langs.size === 1 ? [...langs][0]! : null;
}
