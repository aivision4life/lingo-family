import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { DevClockPanel } from "@/features/review/DevClockPanel";
import { LangSummaryList } from "@/features/review/LangSummaryList";

/** Screen 2 — due/new counts per learning language with "Start review" (streak comes with stats). */
export function HomePage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  if (!profile) return null;

  return (
    <PageShell title={t("pages.home.title")}>
      <DevClockPanel />
      <LangSummaryList profileId={profile.id} />
      <LinkButton to="/practice" variant="secondary" size="lg">
        {t("pages.home.practiceSpeaking")}
      </LinkButton>
      <LinkButton to="/stats" variant="outline">
        {t("pages.home.stats")}
      </LinkButton>
    </PageShell>
  );
}
