import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";

/** Screen 6 — audio, image, readings, glosses, examples, related characters. */
export function WordDetailPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();

  return (
    <PageShell title={t("pages.wordDetail.title")} milestone="M1">
      <LinkButton to={`/practice/${id}`} size="lg">
        {t("pages.wordDetail.practice")}
      </LinkButton>
      <LinkButton to={`/words/${id}/edit`} variant="secondary">
        {t("pages.wordDetail.edit")}
      </LinkButton>
      {/* Sample character until words have real character links (F7). */}
      <LinkButton to="/chars/学" variant="outline">
        {t("pages.wordDetail.character")}
      </LinkButton>
    </PageShell>
  );
}
