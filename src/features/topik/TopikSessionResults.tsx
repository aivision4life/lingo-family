import { useTranslation } from "react-i18next";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { MarkedTermsCard } from "./MarkedTermsCard";
import type { SessionSummary } from "./sessionState";

/** Shown once the practice session is done (M6.3; score summary + skip M6.5-ish): the score only
 * ever counts questions actually answered — a skipped one counts toward neither — plus the terms
 * marked "Thêm vào thư viện" while practicing (`MarkedTermsCard`, shared with a sitting's result
 * since M7.12). */
export function TopikSessionResults({ summary }: { summary: SessionSummary }) {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();

  if (!profile) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="pt-4 text-center text-lg">{t("topik.practice.sessionDone")}</p>
      <div className="flex flex-col items-center gap-1 pb-2 text-center">
        <p className="text-3xl font-bold">{t("topik.practice.results.score", { correct: summary.correct, answered: summary.answered })}</p>
        {summary.skipped > 0 && (
          <p className="text-sm text-muted-foreground">{t("topik.practice.results.skippedNote", { count: summary.skipped })}</p>
        )}
      </div>
      <MarkedTermsCard profileId={profile.id} level={profile.is_kid ? "kid" : "beginner"} />
    </div>
  );
}
