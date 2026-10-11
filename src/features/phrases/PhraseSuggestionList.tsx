import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import { LangText } from "@/components/LangText";
import { AiBadge } from "@/features/words/bits";
import type { PhraseDraft, PhraseDraftErrors } from "./phraseDraft";
import { PhraseFields } from "./PhraseFields";

type Props = {
  lang: LearnLang;
  drafts: PhraseDraft[];
  errors: Record<string, PhraseDraftErrors>;
  onChange: (drafts: PhraseDraft[]) => void;
  assist?: { profileId: string; rootTerm: string; rootGloss: string };
};

/** Checkbox list of suggested phrases (unticked by default); a ticked phrase can be edited. */
export function PhraseSuggestionList({ lang, drafts, errors, onChange, assist }: Props) {
  const { t } = useTranslation();
  const update = (key: string, patch: Partial<PhraseDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <ul className="flex flex-col gap-3">
      {drafts.map((d) => (
        <li key={d.key} className="rounded-lg border p-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-primary"
              checked={d.selected}
              aria-label={t("phrases.select", { text: d.text })}
              onChange={(e) => update(d.key, { selected: e.target.checked })}
            />
            <span className="flex min-w-0 flex-col">
              <span className="flex items-baseline gap-2">
                <LangText lang={lang} className="text-lg font-semibold">
                  {d.text}
                </LangText>
                <span className="truncate text-sm text-muted-foreground">{d.reading}</span>
                {d.ai_generated && <AiBadge />}
              </span>
              <span lang="vi" className="text-sm">
                {d.gloss_vi}
              </span>
            </span>
          </label>
          {d.selected && (
            <div className="mt-3 border-t pt-3">
              <PhraseFields lang={lang} draft={d} errors={errors[d.key]} onChange={(p) => update(d.key, p)} assist={assist} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
