import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";

// Screens that have no navigation of their own yet. Move each into its own file
// (or src/features/<feature>/) once it gets real content.

/** Screen 9 — create decks, assign them to profiles. */
export function DecksPage() {
  const { t } = useTranslation();
  return <PageShell title={t("pages.decks.title")} milestone="M1" />;
}

/** Screen 11 (P2) — streak, reviews per day, retention. */
export function StatsPage() {
  const { t } = useTranslation();
  return <PageShell title={t("pages.stats.title")} milestone="M5" />;
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <PageShell title={t("pages.notFound.title")}>
      <LinkButton to="/home">{t("pages.notFound.goHome")}</LinkButton>
    </PageShell>
  );
}
