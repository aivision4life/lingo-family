import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { useTopikBlocks } from "@/features/topik/api";

/** Screen (M6.1) — `/topik`: pick a question-number block to practice. */
export function TopikBlockPickerPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const blocks = useTopikBlocks();
  if (!profile) return null;

  return (
    <PageShell title={t("topik.title")}>
      {canManageProfiles(profile) && (
        <LinkButton to="/topik/manage" variant="outline">
          {t("topik.manage.title")}
        </LinkButton>
      )}
      {blocks.isPending ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : blocks.isError ? (
        <p className="text-destructive">{t("common.loadError")}</p>
      ) : blocks.data.length === 0 ? (
        <p className="text-muted-foreground">{t("topik.noBlocks")}</p>
      ) : (
        blocks.data.map((b) => (
          <LinkButton key={b.block} to={`/topik/practice?from=${b.from}&to=${b.to}`} variant="secondary" size="lg" className="justify-between">
            <span>{t("topik.blockLabel", { block: b.block })}</span>
            <span className="text-sm text-muted-foreground">{t("topik.blockCount", { count: b.count })}</span>
          </LinkButton>
        ))
      )}
    </PageShell>
  );
}
