import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TOPIK_SECTIONS, type TopikSection } from "@shared/enums";
import type { TopikBlock } from "@shared/topik";
import { Button } from "@/components/ui/button";
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
  const [section, setSection] = useState<TopikSection>("reading");
  const blocks = useTopikBlocks(canManageProfiles(profile) ? (profile?.id ?? "") : "", section);
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
      <div className="flex flex-wrap gap-2">
        {TOPIK_SECTIONS.map((s) => (
          <Button key={s} size="sm" variant={section === s ? "default" : "outline"} onClick={() => setSection(s)}>
            {t(`topik.section.${s}`)}
          </Button>
        ))}
      </div>
      {blocks.isPending ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : blocks.isError ? (
        <p className="text-destructive">{t("common.loadError")}</p>
      ) : blocks.data.length === 0 ? (
        <p className="text-muted-foreground">{t("topik.noBlocks")}</p>
      ) : (
        <BlockList blocks={blocks.data} section={section} />
      )}
    </PageShell>
  );
}

/** Every block, then one total row set apart by a rule above it (M6.9). */
function BlockList({ blocks, section }: { blocks: TopikBlock[]; section: TopikSection }) {
  const { t } = useTranslation();
  const totals = blockTotals(blocks);

  return (
    <>
      {blocks.map((b) => (
        <LinkButton
          key={b.block}
          to={`/topik/practice?section=${section}&from=${b.from}&to=${b.to}`}
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
 * for what the profile already knows (its card reached ts-fsrs Review), a mid tone for what it has
 * answered but not learnt yet — then the empty remainder.
 *
 * "Đã xong" appears only once every question is *known*. It used to appear once every question had
 * been answered once, which read as "nothing left here" on a block the learner remembered nothing
 * from. The counts are always spelled out, zeros included: "thuộc 0/7" is exactly the fact that
 * mislabelled block was hiding.
 */
function BlockRow({ label, block, bold = false }: { label: string; block: Pick<TopikBlock, "count" | "unseen" | "mastered">; bold?: boolean }) {
  const { t } = useTranslation();
  const { masteredPercent, learningPercent, status } = blockProgress(block);
  const done = status === "done";

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("truncate", bold && "font-semibold")}>{label}</span>
        {done ? (
          <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" aria-hidden />
            {t("topik.blockDone", { total: block.count })}
          </span>
        ) : (
          <span className={cn("shrink-0 text-sm", status === "partial" ? "text-foreground" : "text-muted-foreground")}>
            <span className={status === "partial" ? "font-medium" : undefined}>
              {t("topik.blockMastered", { mastered: block.mastered, total: block.count })}
            </span>
            <span className="text-muted-foreground"> · {t("topik.blockUnanswered", { unseen: block.unseen })}</span>
          </span>
        )}
      </div>
      <div
        // Not bg-muted (the usual track): it is the same token value as the secondary button these
        // rows sit on, so the unfinished part would be invisible exactly where it matters most.
        className="flex h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={block.count}
        aria-valuenow={block.mastered}
      >
        {/* Three clearly separated tones, all from existing tokens: near-black primary (known),
            mid-grey muted-foreground (answered, not known), light border (untouched). A fully
            mastered block is faded — nothing is left to do there, so it must not shout. */}
        <div className={cn("h-full transition-all", done ? "bg-primary/30" : "bg-primary")} style={{ width: `${masteredPercent}%` }} />
        <div className="h-full bg-muted-foreground/70 transition-all" style={{ width: `${learningPercent}%` }} />
      </div>
    </div>
  );
}
