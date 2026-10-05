import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { PageShell } from "@/components/PageShell";

/** Screen 8 (F7) — one Chinese character and every library word containing it. */
export function CharacterPage() {
  const { t } = useTranslation();
  const { char = "" } = useParams();

  return (
    <PageShell title={t("pages.character.title")} milestone="M4">
      {/* Keyed by simplified character, so it is rendered as zh-CN. */}
      <p lang="zh-CN" className="text-center text-8xl">
        {char}
      </p>
    </PageShell>
  );
}
