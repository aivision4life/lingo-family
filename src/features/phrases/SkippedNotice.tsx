import { useTranslation } from "react-i18next";
import type { SkippedPhrase } from "@shared/phrase";

/** Light notice for ticked phrases that were not saved because they already exist. */
export function SkippedNotice({ skipped }: { skipped: SkippedPhrase[] }) {
  const { t } = useTranslation();
  if (skipped.length === 0) return null;
  return (
    <ul role="status" className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      {skipped.map((s) => (
        <li key={s.text}>{t("phrases.skipped", { text: s.text, word: s.existing_word_term })}</li>
      ))}
    </ul>
  );
}
