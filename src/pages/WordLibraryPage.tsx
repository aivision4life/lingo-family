import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";

/** Screen 4 — word list with search and filters. */
export function WordLibraryPage() {
  const { t } = useTranslation();

  return (
    <PageShell title={t("pages.words.title")} milestone="M1">
      <LinkButton to="/words/new" size="lg">
        {t("pages.words.addWord")}
      </LinkButton>
      {/* Placeholder link until real words exist. */}
      <LinkButton to="/words/sample" variant="outline">
        {t("pages.words.sampleWord")}
      </LinkButton>
    </PageShell>
  );
}
