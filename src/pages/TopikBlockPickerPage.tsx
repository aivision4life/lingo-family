import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { TOPIK_SECTIONS, type TopikSection } from "@shared/enums";
import type { TopikBlock } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { useTopikBlocks, useTopikFacets } from "@/features/topik/api";
import { PracticeRangePicker } from "@/features/topik/PracticeRangePicker";
import { blockProgress, blockTotals } from "@/features/topik/blockProgress";
import { formatDueFromNow } from "@/features/topik/dueIn";
import { cn } from "@/lib/utils";

/**
 * Screen (M6.1; range + exam filter M7.24) — `/topik`: pick what to practise.
 *
 * Three ways in, narrowing: a paper's own blocks, a range of question numbers typed by hand, and
 * (from the management screen) a single question. The paper filter scopes the first two together,
 * so the screen always describes one set of questions rather than two.
 *
 * Section and exam live in the URL, not in `useState`: this screen is worth bookmarking once a
 * range is being drilled across several sittings, and Back from a practice session must return to
 * the filter that was chosen, not to reading/all.
 */
export function TopikBlockPickerPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const section: TopikSection = params.get("section") === "listening" ? "listening" : "reading";
  const exam = params.get("exam");
  const profileId = canManageProfiles(profile) ? (profile?.id ?? "") : "";
  const blocks = useTopikBlocks(profileId, section, exam);
  // Only approved questions can be practised, so only papers that have some are worth offering.
  const facets = useTopikFacets(profileId, section, true);
  const setFilter = (next: { section?: TopikSection; exam?: string | null }) => {
    const sec = next.section ?? section;
    const ex = next.exam === undefined ? exam : next.exam;
    setParams(ex ? { section: sec, exam: ex } : { section: sec }, { replace: true });
  };
  const maxNumber = Math.max(1, ...(blocks.data ?? []).map((b) => b.to));
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
      {/* Sitting a whole paper is a different exercise from block practice, so it gets its own
          entry rather than another length option inside the picker (M6.4). */}
      <LinkButton to="/topik/tests" variant="outline">
        {t("topik.test.title")}
      </LinkButton>
      {canManageProfiles(profile) && (
        <LinkButton to="/topik/manage" variant="outline">
          {t("topik.manage.title")}
        </LinkButton>
      )}
      <div className="flex flex-wrap gap-2">
        {TOPIK_SECTIONS.map((s) => (
          // Changing section drops the paper filter: an exam label belongs to one section, and
          // keeping it would silently ask for a paper that cannot be in the new list.
          <Button key={s} size="sm" variant={section === s ? "default" : "outline"} onClick={() => setFilter({ section: s, exam: null })}>
            {t(`topik.section.${s}`)}
          </Button>
        ))}
      </div>

      <select
        value={exam ?? ""}
        onChange={(e) => setFilter({ exam: e.target.value === "" ? null : e.target.value })}
        aria-label={t("topik.picker.examFilter")}
        className="min-h-11 rounded-lg border bg-background px-3 text-sm"
      >
        <option value="">{t("topik.picker.examAll")}</option>
        {facets.data?.exams.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      {blocks.isPending ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : blocks.isError ? (
        <p className="text-destructive">{t("common.loadError")}</p>
      ) : blocks.data.length === 0 ? (
        <p className="text-muted-foreground">{t("topik.noBlocks")}</p>
      ) : (
        <BlockList blocks={blocks.data} section={section} exam={exam} />
      )}

      {/* Below the blocks on purpose: the paper's own divisions are the common case, and this is
          the one for drilling a kind of question across papers (M7.24). `mode=all` because a range
          typed by hand is a deliberate choice of questions, not a question of what is due — and
          since M7.24 that costs nothing, as each question decides for itself whether it counts. */}
      {(blocks.data?.length ?? 0) > 0 && (
        <PracticeRangePicker
          profileId={profileId}
          section={section}
          exam={exam}
          maxNumber={maxNumber}
          onStart={({ from, to }) =>
            navigate(`/topik/practice?section=${section}&from=${from}&to=${to}&mode=all${exam ? `&exam=${encodeURIComponent(exam)}` : ""}`)
          }
        />
      )}
    </PageShell>
  );
}

/**
 * Every block, then one total row set apart by a rule above it (M6.9).
 *
 * A block whose every question is being kept for a mock test (M7.27) is **not a link**: opening it
 * could only produce an empty session, and an empty session that explains nothing is the thing
 * this project keeps finding. It says so in place instead, and names the way in — one paper.
 */
function BlockList({ blocks, section, exam }: { blocks: TopikBlock[]; section: TopikSection; exam: string | null }) {
  const { t } = useTranslation();
  const totals = blockTotals(blocks);
  const allPapers = exam === null;

  return (
    <>
      {blocks.map((b) =>
        allPapers && b.count > 0 && b.reserved_for_tests === b.count ? (
          // Same padding as the size="lg" links around it, so the column does not jump.
          <div key={b.block} className="rounded-lg border bg-muted/40 px-6 py-3">
            <BlockRow label={t("topik.blockLabel", { block: b.block })} block={b} allPapers />
          </div>
        ) : (
          <LinkButton
            key={b.block}
            to={`/topik/practice?section=${section}&from=${b.from}&to=${b.to}${exam ? `&exam=${encodeURIComponent(exam)}` : ""}`}
            variant="secondary"
            size="lg"
            className="h-auto flex-col items-stretch gap-1.5 py-3"
          >
            <BlockRow label={t("topik.blockLabel", { block: b.block })} block={b} allPapers={allPapers} />
          </LinkButton>
        ),
      )}
      {/* px-6 matches the size="lg" rows above, so the labels and bars line up in one column. */}
      <div className="mt-1 border-t px-6 pt-3">
        <BlockRow label={t("topik.blockTotal")} block={totals} allPapers={allPapers} bold />
      </div>
    </>
  );
}

/**
 * The bar is the thing to read; the numbers beside it are the detail. Two filled segments — dark
 * for what the profile already knows (its card reached ts-fsrs Review), a mid tone for what it has
 * answered but not learnt yet — then the empty remainder.
 *
 * "đã thuộc hết" appears only once every question is *known*. It used to appear once every question
 * had been answered once, which read as "nothing left here" on a block the learner remembered
 * nothing from. The counts are always spelled out, zeros included: "thuộc 0" is exactly the fact
 * that mislabelled block was hiding.
 *
 * **The block's size is said once, first, and the rest are plain counts** (M7.26): "24 câu ·
 * thuộc 0 · chưa làm 23". It used to read "thuộc 0/24 · chưa làm 23", where two numbers sat side
 * by side with only one of them carrying a denominator — and the owner read the 23 as the size of
 * the block and reported three questions missing from a bank that was complete. A number is worth
 * showing only if it cannot be mistaken for a different number.
 */
function BlockRow({
  label,
  block,
  allPapers,
  bold = false,
}: {
  label: string;
  block: Pick<TopikBlock, "count" | "unseen" | "mastered" | "due" | "later" | "next_due_at" | "reserved_for_tests">;
  /** "Tất cả các đề" is the scope that keeps unanswered questions for a mock test (M7.27), so the
   * same block says "chưa làm N" in one paper and "dành cho thi thử N" across all of them. */
  allPapers: boolean;
  bold?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { masteredPercent, learningPercent, status } = blockProgress(block);
  const done = status === "done";
  // Why a block with work left can still open an empty session: everything in it has been answered
  // and is waiting out its interval. Without this line the screen looks broken (M7.2).
  const waiting = block.later > 0 && block.next_due_at !== null;
  // Nothing here can be practised across every paper — the whole block is a mock test's to give.
  const reservedOnly = allPapers && block.count > 0 && block.reserved_for_tests === block.count;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("truncate", bold && "font-semibold")}>{label}</span>
        {done ? (
          <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            {t("topik.blockSize", { total: block.count })} ·<Check className="size-4" aria-hidden />
            {t("topik.blockAllKnown")}
          </span>
        ) : (
          <span className={cn("shrink-0 text-sm", status === "partial" ? "text-foreground" : "text-muted-foreground")}>
            {/* The size first and alone: every number after it is a plain count of that total. */}
            <span className="text-muted-foreground">{t("topik.blockSize", { total: block.count })}</span>
            <span className={status === "partial" ? "font-medium" : undefined}> · {t("topik.blockMastered", { mastered: block.mastered })}</span>
            <span className="text-muted-foreground">
              {" · "}
              {allPapers ? t("topik.blockReserved", { count: block.reserved_for_tests }) : t("topik.blockUnanswered", { unseen: block.unseen })}
            </span>
          </span>
        )}
      </div>
      {waiting && (
        <p className="text-xs text-muted-foreground">
          {t("topik.blockWaiting", { count: block.later, when: formatDueFromNow(block.next_due_at!, i18n.language) })}
        </p>
      )}
      {reservedOnly && <p className="text-xs text-muted-foreground">{t("topik.reservedOnly", { count: block.reserved_for_tests })}</p>}
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
