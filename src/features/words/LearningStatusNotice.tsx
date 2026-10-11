import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { z } from "zod";

/** Set by the Add word screen (M2.7): false when the word's language is not in the creator's study_langs. */
const navStateSchema = z.object({ addedToLearning: z.boolean() });

/** Light notice right after saving a word whose language the profile is not studying yet. */
export function LearningStatusNotice() {
  const { t } = useTranslation();
  const location = useLocation();
  const nav = navStateSchema.safeParse(location.state);
  if (!nav.success || nav.data.addedToLearning) return null;

  return (
    <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      {t("words.notInStudyLangs")}
    </p>
  );
}
