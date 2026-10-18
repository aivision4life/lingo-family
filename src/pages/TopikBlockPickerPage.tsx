import { useTranslation } from "react-i18next";
import type { TopikBlock } from "@shared/topik";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { useTopikBlocks } from "@/features/topik/api";
import { blockTotals } from "@/features/topik/blockTotals";

/** Screen (M6.1) — `/topik`: pick a question-number block to practice. */
export function TopikBlockPickerPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const blocks = useTopikBlocks(profile?.id ?? "");
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
        <BlockList blocks={blocks.data} />
      )}
    </PageShell>
  );
}

/** Each block, then one total row (M6.9). "Not studied" counts the questions this profile has
 * never answered — skipping one during a session writes no attempt, so it stays counted. */
function BlockList({ blocks }: { blocks: TopikBlock[] }) {
  const { t } = useTranslation();
  const totals = blockTotals(blocks);
  const unseenLabel = (unseen: number, total: number) => t("topik.blockUnseen", { unseen, total });

  return (
    <>
      {blocks.map((b) => (
        <LinkButton
          key={b.block}
          to={`/topik/practice?from=${b.from}&to=${b.to}`}
          variant="secondary"
          size="lg"
          className="justify-between gap-3"
        >
          <span>{t("topik.blockLabel", { block: b.block })}</span>
          <span className="text-sm text-muted-foreground">{unseenLabel(b.unseen, b.count)}</span>
        </LinkButton>
      ))}
      {/* Same shape as a block row, but not a link: it is a tally, not a practice range. */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 font-medium">
        <span>{t("topik.blockTotal")}</span>
        <span className="text-sm text-muted-foreground">{unseenLabel(totals.unseen, totals.count)}</span>
      </div>
    </>
  );
}
