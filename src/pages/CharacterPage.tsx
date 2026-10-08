import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { PageShell } from "@/components/PageShell";

/** Screen 8 (F7) — one Hanja character and every Korean word/phrase containing it. */
export function CharacterPage() {
  const { t } = useTranslation();
  const { char = "" } = useParams();

  return (
    <PageShell title={t("pages.character.title")} milestone="M4">
      {/* Hanja are shown with the Korean font. */}
      <p lang="ko" className="text-center text-8xl">
        {char}
      </p>
    </PageShell>
  );
}
