import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { TopikKeyTermView } from "@shared/topik";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { AiBadge } from "@/features/words/bits";
import { TopikMarkToggle } from "./TopikMarkToggle";
import { isGrammarEntry } from "./vocabSegments";

type Props = {
  explanation_vi: string | null;
  key_terms: TopikKeyTermView[];
  /** false while generation (kicked off at session start, M6.4-ish) is still running — the parent polls
   * and re-renders once it finishes, so this flips to true without ever needing a new attempt. */
  ready: boolean;
  /** Shown right away for a wrong answer; a correct answer only gets the "Xem giải thích" link. */
  autoShow: boolean;
};

/** Answer explanation + key terms (M6.3; generation moved to practice time M6.4-ish): revealing an
 * already-ready explanation is purely a local show/hide, never a new request. For a wrong answer
 * whose explanation isn't ready yet, shows a loading state instead of nothing (never blocks moving
 * to the next question). A correct answer just waits silently until the "Xem giải thích" link exists. */
export function TopikExplanation({ explanation_vi, key_terms, ready, autoShow }: Props) {
  const { t } = useTranslation();
  const [show, setShow] = useState(autoShow);

  if (!ready) {
    return autoShow ? <p className="text-sm text-muted-foreground">{t("topik.practice.explain.generating")}</p> : null;
  }
  if (explanation_vi === null) return null;

  if (!show) {
    return (
      <button type="button" onClick={() => setShow(true)} className="self-start text-sm font-medium text-primary underline underline-offset-4">
        {t("topik.practice.explain.show")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-1">
        <h3 className="text-sm font-semibold">{t("topik.practice.explain.title")}</h3>
        <AiBadge />
      </div>
      <p className="text-sm">{explanation_vi}</p>
      {key_terms.length > 0 && (
        <ul className="flex flex-col gap-2 border-t pt-2">
          {key_terms.map((term) => (
            <KeyTermRow key={term.lemma} term={term} />
          ))}
        </ul>
      )}
    </div>
  );
}

function KeyTermRow({ term }: { term: TopikKeyTermView }) {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const isGrammar = isGrammarEntry(term.pos);
  return (
    <li className="flex min-h-11 items-center justify-between gap-2 text-sm">
      <span>
        <span lang="ko" className="font-medium">
          {term.lemma}
        </span>{" "}
        — {term.gloss_vi}
      </span>
      {!isGrammar &&
        (term.existing_word_id ? (
          <Link to={`/words/${term.existing_word_id}`} className="shrink-0 text-sm font-medium text-primary underline underline-offset-4">
            {t("topik.practice.word.alreadyInLibrary")}
          </Link>
        ) : (
          canManageProfiles(profile) && <TopikMarkToggle lemma={term.lemma} gloss_vi={term.gloss_vi} />
        ))}
    </li>
  );
}
