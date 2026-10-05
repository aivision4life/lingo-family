import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";

/** Screen 3 — card front → flip → rating buttons, with a progress bar. */
export function ReviewPage() {
  const { t } = useTranslation();

  return (
    <PageShell title={t("pages.review.title")} milestone="M1">
      <LinkButton to="/home" variant="outline">
        {t("pages.review.endSession")}
      </LinkButton>
    </PageShell>
  );
}
