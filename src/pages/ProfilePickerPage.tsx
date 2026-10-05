import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";

/** Screen 1 — shown on app start, outside the main layout. */
export function ProfilePickerPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center">
      <PageShell title={t("pages.profiles.title")} milestone="M1">
        <LinkButton to="/home" size="lg">
          {t("pages.profiles.continue")}
        </LinkButton>
        <LanguageSwitcher />
      </PageShell>
    </div>
  );
}
