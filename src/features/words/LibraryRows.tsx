import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { UiLang } from "@shared/enums";
import type { PhraseSummary } from "@shared/phrase";
import type { WordSummary } from "@shared/word";
import { LangText } from "@/components/LangText";
import { SpeakButton } from "@/features/audio/AudioButtons";
import { ItemImage } from "@/features/images/ItemImage";
import { AiBadge } from "./bits";
import { glossFor } from "./format";

const ROW = "flex min-h-16 min-w-0 flex-1 items-center gap-3 px-3 py-2 hover:bg-accent";

export type RowSelect = { checked: boolean; onToggle: () => void };

function WordRowBody({ w, glossLang }: { w: WordSummary; glossLang: UiLang }) {
  const { t } = useTranslation();
  return (
    <>
      <ItemImage kind="word" id={w.id} image={w} alt={glossFor(w, glossLang)} emoji={w.emoji} size="thumb" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <LangText lang={w.lang} className="truncate text-xl font-semibold">
            {w.term}
          </LangText>
          <span className="truncate text-sm text-muted-foreground">{w.reading}</span>
        </span>
        <span lang={glossLang} className="truncate text-sm">
          {glossFor(w, glossLang)}
        </span>
      </span>
      {w.phrase_count > 0 && (
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs">{t("phrases.count", { count: w.phrase_count })}</span>
      )}
      {w.ai_generated && !w.verified && <AiBadge />}
    </>
  );
}

/**
 * A word in a list. With `select` (the "select many" mode) the whole row is a checkbox instead of
 * a link to Word detail, and there is no speaker button.
 */
export function WordRow({ w, glossLang, select }: { w: WordSummary; glossLang: UiLang; select?: RowSelect }) {
  const { t } = useTranslation();
  if (select) {
    return (
      <li>
        <button
          type="button"
          role="checkbox"
          aria-checked={select.checked}
          onClick={select.onToggle}
          className={`${ROW} w-full text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${select.checked ? "bg-accent" : ""}`}
        >
          <span
            aria-hidden
            className={`flex size-6 shrink-0 items-center justify-center rounded-md border-2 ${select.checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"}`}
          >
            {select.checked && <Check className="size-4" />}
          </span>
          <WordRowBody w={w} glossLang={glossLang} />
        </button>
      </li>
    );
  }
  // The speaker is a sibling of the link: a button cannot be nested inside <a>.
  return (
    <li className="flex items-center pr-1">
      <Link to={`/words/${w.id}`} className={ROW}>
        <WordRowBody w={w} glossLang={glossLang} />
      </Link>
      <SpeakButton audioKey={w.audio_key} label={t("audio.play")} />
    </li>
  );
}

/** A phrase opens the Word detail of its root word. */
export function PhraseRow({ p, glossLang }: { p: PhraseSummary; glossLang: UiLang }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center pr-1">
      <Link to={`/words/${p.word_id}`} className={ROW}>
        <ItemImage kind="phrase" id={p.id} image={p} alt={glossFor(p, glossLang)} emoji={p.emoji} size="thumb" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <LangText lang={p.lang} className="truncate text-xl font-semibold">
              {p.text}
            </LangText>
            <span className="truncate text-sm text-muted-foreground">{p.reading}</span>
          </span>
          <span lang={glossLang} className="truncate text-sm">
            {glossFor(p, glossLang)}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {t("phrases.root", { word: p.root_term })}
          </span>
        </span>
        {p.ai_generated && !p.verified && <AiBadge />}
      </Link>
      <SpeakButton audioKey={p.audio_key} label={t("phrases.play", { text: p.text })} />
    </li>
  );
}
