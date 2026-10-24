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
  const blocks = useTopikBlocks(canManageProfiles(profile) ? (profile?.id ?? "") : "");
  if (!profile) return null;
  // Not just hidden from the nav: TOPIK II is an advanced-learner exam and a session has the
  // server generate its vocabulary/explanations, which kid profiles never trigger (SPEC §10).
  if (!canManageProfiles(profile)) {
    return (
      <PageShell title={t("topik.title")}>
        <p>{t("topik.kidNotAllowed")}</p>
      </PageShell>
    );
  }

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
        <BlockRow label={t("topik.blockTotal")} block={totals} bold />
      </div>
    </>
  );
}

/**
 * The bar is the thing to read; the numbers beside it are the detail. Two filled segments — dark
 * for what the profile already knows (its card reached ts-fsrs Review), lighter for what it has
 * answered but not learnt yet — then the empty remainder. The three states must not look alike: a
 * finished block ("0 left of 7") and an untouched one ("24 left of 24") both have nothing
 * outstanding on screen but mean opposite things.
 */
function BlockRow({ label, block, bold = false }: { label: string; block: Pick<TopikBlock, "count" | "unseen" | "mastered">; bold?: boolean }) {
  const { t } = useTranslation();
  const { studied, masteredPercent, learningPercent, status } = blockProgress(block);
  const done = status === "done";

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("truncate", bold && "font-semibold")}>{label}</span>
        <span className="flex shrink-0 items-baseline gap-1.5 text-sm">
          {/* "thuộc 0" on a block nobody has opened yet is noise, so it only appears once there is
              something to report. */}
          {block.mastered > 0 && (
            <>
              <span className="text-muted-foreground">{t("topik.blockMastered", { mastered: block.mastered })}</span>
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
            </>
          )}
          {done ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Check className="size-4 self-center" aria-hidden />
              {t("topik.blockDone", { total: block.count })}
            </span>
          ) : (
            <span className={cn(status === "partial" ? "font-medium text-foreground" : "text-muted-foreground")}>
              {t("topik.blockLeftOf", { left: block.unseen, total: block.count })}
            </span>
          )}
        </span>
      </div>
      <div
        // Not bg-muted (the usual track): it is the same token value as the secondary button these
        // rows sit on, so the unfinished part would be invisible exactly where it matters most.
        className="flex h-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={block.count}
        aria-valuenow={studied}
      >
        {/* A finished block keeps both segments faded: a full, solid bar would be the loudest
            thing on the screen while being the one block there is nothing left to do in. */}
        <div className={cn("h-full transition-all", done ? "bg-primary/30" : "bg-primary")} style={{ width: `${masteredPercent}%` }} />
        <div className={cn("h-full transition-all", done ? "bg-primary/15" : "bg-primary/40")} style={{ width: `${learningPercent}%` }} />
      </div>
    </div>
  );
}
