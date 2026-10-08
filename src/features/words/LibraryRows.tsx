import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { UiLang } from "@shared/enums";
import type { PhraseSummary } from "@shared/phrase";
import type { WordSummary } from "@shared/word";
import { LangText } from "@/components/LangText";
import { SpeakButton } from "@/features/audio/AudioButtons";
import { AiBadge } from "./bits";
import { glossFor } from "./format";

const ROW = "flex min-h-16 min-w-0 flex-1 items-center gap-3 px-3 py-2 hover:bg-accent";

// The speaker is a sibling of the link: a button cannot be nested inside <a>.

export function WordRow({ w, glossLang }: { w: WordSummary; glossLang: UiLang }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center pr-1">
      <Link to={`/words/${w.id}`} className={ROW}>
        <span className="w-10 text-center text-3xl" aria-hidden>
          {w.emoji}
        </span>
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
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs">
            {t("phrases.count", { count: w.phrase_count })}
          </span>
        )}
        {w.ai_generated && !w.verified && <AiBadge />}
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
