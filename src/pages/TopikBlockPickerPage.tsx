import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TopikBlock } from "@shared/topik";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { useTopikBlocks } from "@/features/topik/api";
import { blockProgress, blockTotals } from "@/features/topik/blockProgress";
import { cn } from "@/lib/utils";

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

/** Every block, then one total row set apart by a rule above it (M6.9). */
function BlockList({ blocks }: { blocks: TopikBlock[] }) {
  const { t } = useTranslation();
  const totals = blockTotals(blocks);

  return (
    <>
      {blocks.map((b) => (
        <LinkButton
          key={b.block}
          to={`/topik/practice?from=${b.from}&to=${b.to}`}
          variant="secondary"
          size="lg"
          className="h-auto flex-col items-stretch gap-1.5 py-3"
        >
          <BlockRow label={t("topik.blockLabel", { block: b.block })} block={b} />
        </LinkButton>
      ))}
      {/* px-6 matches the size="lg" rows above, so the labels and bars line up in one column. */}
      <div className="mt-1 border-t px-6 pt-3">
        <BlockRow label={t("topik.blockTotal")} block={totals} bold showTotal />
      </div>
    </>
  );
}

/**
 * The bar is the thing to read; the number beside it is the detail. The three states must not look
 * alike: a finished block ("0 left of 7") and an untouched one ("24 left of 24") both have nothing
 * outstanding on screen but mean opposite things, so they differ in bar fill, label and weight.
 */
function BlockRow({
  label,
  block,
  bold = false,
  showTotal = false,
}: {
  label: string;
  block: Pick<TopikBlock, "count" | "unseen">;
  bold?: boolean;
  showTotal?: boolean;
}) {
  const { t } = useTranslation();
  const { studied, percent, status } = blockProgress(block);
  const left = showTotal ? t("topik.blockLeftOf", { left: block.unseen, total: block.count }) : t("topik.blockLeft", { left: block.unseen });

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className={cn("truncate", bold && "font-semibold")}>{label}</span>
        {status === "done" ? (
          <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" aria-hidden />
            {t("topik.blockDone")}
          </span>
        ) : (
          <span className={cn("shrink-0 text-sm", status === "partial" ? "font-medium text-foreground" : "text-muted-foreground")}>{left}</span>
        )}
      </div>
      <div
        // Not bg-muted (the usual track): it is the same token value as the secondary button these
        // rows sit on, so the unfinished part would be invisible exactly where it matters most.
        className="h-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={block.count}
        aria-valuenow={studied}
      >
        <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
