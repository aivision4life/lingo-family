import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";

/** Screen 5 — add (/words/new) or edit (/words/:id/edit): term → AI enrich preview → edit → save. */
export function WordEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();

  return (
    <PageShell title={t(id ? "pages.wordEdit.title" : "pages.wordNew.title")} milestone="M1">
      <Button variant="outline" onClick={() => void navigate(-1)}>
        {t("common.back")}
      </Button>
    </PageShell>
  );
}
