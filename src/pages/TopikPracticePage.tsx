import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import type { TopikSection } from "@shared/enums";
import type { TopikSessionMode } from "@shared/topik";
import { LinkButton } from "@/components/LinkButton";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useTopikBlocks, useTopikSession } from "@/features/topik/api";
import { formatDueFromNow } from "@/features/topik/dueIn";
import { MarkedWordsProvider } from "@/features/topik/MarkedWordsProvider";
import { readSession, restoreSession } from "@/features/topik/sessionProgress";
import { UnsavedMarksGuard } from "@/features/topik/UnsavedMarksGuard";
import { TopikSession } from "@/features/topik/TopikSession";

/** Screen (M6.1; explanation + key terms M6.3) — `/topik/practice?from=&to=`: one TOPIK question at
 * a time, answer revealed at once. Marking a word to add to the library (M6.2/M6.3) never leaves
 * this screen — see `MarkedWordsProvider` — so leaving with marks still pending needs confirming. */
export function TopikPracticePage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [params] = useSearchParams();
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  // Reading unless the link says otherwise, so an old bookmark keeps working.
  const section: TopikSection = params.get("section") === "listening" ? "listening" : "reading";
  // "all" is only ever reached by tapping "practise anyway" on the empty screen, so it lives in
  // the URL: going back lands on the normal, scheduled session rather than silently repeating it.
  const mode: TopikSessionMode = params.get("mode") === "all" ? "all" : "due";
  /** One paper, or every paper (M7.24) — the picker's filter, carried in the URL. */
  const exam = params.get("exam");
  const profileId = profile?.id ?? "";
  const session = useTopikSession(profileId, section, from, to, mode, exam);
  // Read once per page view, before the questions arrive: reading it again later could pick up a
  // record this very screen has since written.
  const [saved] = useState(() => (profileId ? readSession(profileId) : null));
  const served = session.data?.questions;
  /** Progress from an interrupted session on this device, if it still matches (M7.19). */
  const restored = useMemo(
    () => (served ? restoreSession(saved, { profileId, section, from, to, mode }, served.map((q) => q.id)) : null),
    [saved, served, profileId, section, from, to, mode],
  );

  if (!profile) return null;
  if (session.isPending) return <Shell from={from} to={to}>{<p className="text-muted-foreground">{t("common.loading")}</p>}</Shell>;
  if (session.isError)
    return (
      <Shell from={from} to={to}>
        <p className="text-destructive">{t("common.loadError")}</p>
      </Shell>
    );

  // A session that was finished with words still marked keeps its record on purpose, and the block
  // then has nothing due left to serve — so this branch has to come first, or the one screen that
  // can still add those words to the library would be unreachable (M7.19).
  const questions = restored?.questions ?? session.data.questions;
  if (questions.length === 0)
    return (
      <Shell from={from} to={to}>
        <NothingDue profileId={profile.id} section={section} from={from} to={to} mode={mode} />
      </Shell>
    );

  return (
    // Mounted only now: the provider reads its initial list once, so it must not exist before the
    // restore decision has been made.
    <MarkedWordsProvider initialMarked={restored?.marked}>
      <Shell from={from} to={to}>
        {/* No `key` here: anything that changes it (a refetch did, through `dataUpdatedAt`) remounts
            the session and throws away which question the learner was on. */}
        <TopikSession
          profileId={profile.id}
          questions={questions}
          section={section}
          from={from}
          to={to}
          mode={mode}
          restored={restored}
        />
        {/* Leaving with words still marked asks first — they live only on this device. */}
        <UnsavedMarksGuard />
      </Shell>
    </MarkedWordsProvider>
  );
}

/** Title and exit button, shared by every branch. The unsaved-marks guard is *not* here: it needs
 * the provider's context, so it belongs to the one branch that has one — the loading, error and
 * nothing-due screens have nothing markable to lose. */
function Shell({ from, to, children }: { from: number; to: number; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("topik.practice.title", { from, to })}</h1>
        <LinkButton to="/topik" variant="outline">
          <X aria-hidden />
          {t("topik.practice.exit")}
        </LinkButton>
      </div>
      {children}
    </section>
  );
}

/**
 * Why this block has nothing to serve (M7.2).
 *
 * "Không có câu nào để luyện" on a block the picker shows work left in reads as a bug. Almost
 * always the real reason is that every question in it has been answered and is waiting out its
 * interval, so this says how many and when the first one is back — the same numbers the picker
 * shows, from the same endpoint, so the two screens can never disagree.
 */
function NothingDue({
  profileId,
  section,
  from,
  to,
  mode,
}: {
  profileId: string;
  section: TopikSection;
  from: number;
  to: number;
  mode: TopikSessionMode;
}) {
  const { t, i18n } = useTranslation();
  const blocks = useTopikBlocks(profileId, section);
  // A block's own range is what the link was built from, so an exact match is the normal case; a
  // hand-edited range that spans several blocks falls back to everything it covers.
  const covered = (blocks.data ?? []).filter((b) => b.from >= from && b.to <= to);
  const later = covered.reduce((n, b) => n + b.later, 0);
  const nextDueAt = covered.reduce<number | null>(
    (soonest, b) => (b.next_due_at === null ? soonest : soonest === null ? b.next_due_at : Math.min(soonest, b.next_due_at)),
    null,
  );

  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="text-lg">{t("topik.practice.nothingToday")}</p>
      {later > 0 && nextDueAt !== null && (
        <p className="text-sm text-muted-foreground">
          {t("topik.practice.nothingDueDetail", { count: later, when: formatDueFromNow(nextDueAt, i18n.language) })}
        </p>
      )}
      {/* Offered only when there is actually something waiting, and never from inside a
          practise-anyway session that itself came back empty. */}
      {later > 0 && mode === "due" && (
        <LinkButton to={`/topik/practice?section=${section}&from=${from}&to=${to}&mode=all`} variant="outline">
          {t("topik.practice.practiseAnyway")}
        </LinkButton>
      )}
      <p className="max-w-sm text-xs text-muted-foreground">{later > 0 && mode === "due" ? t("topik.practice.practiseAnywayHint") : null}</p>
    </div>
  );
}

