import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";

/** Screen 2 — today's due counts, start review / practice, streak. */
export function HomePage() {
  const { t } = useTranslation();

  return (
    <PageShell title={t("pages.home.title")} milestone="M1">
      <LinkButton to="/review" size="lg">
        {t("pages.home.startReview")}
      </LinkButton>
      <LinkButton to="/practice" variant="secondary" size="lg">
        {t("pages.home.practiceSpeaking")}
      </LinkButton>
      <LinkButton to="/stats" variant="outline">
        {t("pages.home.stats")}
      </LinkButton>
    </PageShell>
  );
}
