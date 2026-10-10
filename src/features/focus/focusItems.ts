// Focus view (M2.5): what can be enlarged, in which order, and how it is addressed in the URL.
// Pure functions, unit tested.
import type { z } from "zod";
import type { exampleSchema } from "@shared/base";
import { UI_LANGS, type LearnLang, type UiLang } from "@shared/enums";
import type { ImageView } from "@shared/image";
import type { Phrase } from "@shared/phrase";
import type { WordDetail } from "@shared/word";

type Example = z.infer<typeof exampleSchema>;

export type FocusKind = "example" | "phrase";

/** One enlargeable item: an example sentence or a phrase. */
export type FocusItem = {
  /** "example:<id>" or "phrase:<id>" (also the `?focus=` value). */
  key: string;
  kind: FocusKind;
  id: string;
  lang: LearnLang;
  text: string;
  /** Phrases have a reading; example sentences have none yet (backlog: romanization / IPA). */
  reading: string | null;
  translations: Record<UiLang, string>;
  image: ImageView;
  emoji: string | null;
  audio_key: string | null;
};

export const focusKey = (kind: FocusKind, id: string) => `${kind}:${id}`;

export function parseFocusKey(value: string | null): { kind: FocusKind; id: string } | null {
  const m = /^(example|phrase):(.+)$/.exec(value ?? "");
  return m ? { kind: m[1] as FocusKind, id: m[2]! } : null;
}

const imageOf = (x: ImageView): ImageView => ({
  image_key: x.image_key,
  image_status: x.image_status,
  image_prompt: x.image_prompt,
  image_source: x.image_source,
  image_requested_at: x.image_requested_at,
});

export function exampleItem(ex: Example, lang: LearnLang, emoji: string | null = null): FocusItem {
  return {
    key: focusKey("example", ex.id),
    kind: "example",
    id: ex.id,
    lang,
    text: ex.sentence,
    reading: null,
    translations: { vi: ex.translation_vi, en: ex.translation_en, ko: ex.translation_ko },
    image: imageOf(ex),
    emoji,
    audio_key: ex.audio_key,
  };
}

export function phraseItem(p: Phrase): FocusItem {
  return {
    key: focusKey("phrase", p.id),
    kind: "phrase",
    id: p.id,
    lang: p.lang,
    text: p.text,
    reading: p.reading || null,
    translations: { vi: p.gloss_vi, en: p.gloss_en, ko: p.gloss_ko },
    image: imageOf(p),
    emoji: p.emoji,
    audio_key: p.audio_key,
  };
}

/** Word detail: the word's own examples first, then each phrase followed by its example(s). */
export function itemsFromWord(w: Pick<WordDetail, "lang" | "emoji" | "examples" | "phrases">): FocusItem[] {
  return [
    ...w.examples.map((ex) => exampleItem(ex, w.lang, w.emoji)),
    ...w.phrases.flatMap((p) => [phraseItem(p), ...p.examples.map((ex) => exampleItem(ex, p.lang, p.emoji ?? w.emoji))]),
  ];
}

/** Back of a review card: only the examples of the current card. */
export const itemsFromExamples = (examples: readonly Example[], lang: LearnLang, emoji: string | null): FocusItem[] =>
  examples.map((ex) => exampleItem(ex, lang, emoji));

/** Position of the active item, or -1 when it is not in the list. */
export const indexOfKey = (items: readonly FocusItem[], key: string | null) => items.findIndex((i) => i.key === key);

/** Next / previous index, stopping at both ends (no wrap-around). */
export const stepIndex = (index: number, delta: -1 | 1, length: number) => Math.min(length - 1, Math.max(0, index + delta));

/** Translations that exist, the profile's gloss language first. */
export function orderedTranslations(translations: Record<UiLang, string>, glossLang: UiLang) {
  return [...UI_LANGS]
    .sort((a, b) => Number(b === glossLang) - Number(a === glossLang))
    .map((lang) => ({ lang, text: translations[lang].trim() }))
    .filter((t) => t.text !== "");
}

/**
 * Swipe → direction: -1 = previous (finger moved right), 1 = next (finger moved left), 0 = not a
 * swipe. Needs a long enough horizontal move that clearly beats the vertical one (scrolling).
 */
export function swipeDirection(dx: number, dy: number, minDistance = 48): -1 | 0 | 1 {
  if (Math.abs(dx) < minDistance || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

// --- URL / history -----------------------------------------------------------------------

export function withFocus(search: string, key: string): string {
  const p = new URLSearchParams(search);
  p.set("focus", key);
  return `?${p.toString()}`;
}

export function withoutFocus(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("focus");
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Opening pushes a history entry (marked with `focusPushed`), so the Back button closes the view
 * and stays on the screen. Closing then goes back; if the page was opened straight on a `?focus=`
 * URL (a reload, a shared link) there is nothing to go back to, so the parameter is removed instead.
 */
export const closeAction = (state: unknown): "back" | "replace" =>
  state && typeof state === "object" && "focusPushed" in state && state.focusPushed === true ? "back" : "replace";
