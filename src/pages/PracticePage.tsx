import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";

/** Screen 7 — reference audio, record button, colored result, history. Route: /practice/:wordId? */
export function PracticePage() {
  const { t } = useTranslation();

  return <PageShell title={t("pages.practice.title")} milestone="M3" />;
}
