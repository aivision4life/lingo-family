import { X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useSearchParams } from "react-router";
import type { TopikSection } from "@shared/enums";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LinkButton } from "@/components/LinkButton";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useTopikBlocks, useTopikSession } from "@/features/topik/api";
import { formatDueFromNow } from "@/features/topik/dueIn";
import { useMarkedWords } from "@/features/topik/markedWords";
import { MarkedWordsProvider } from "@/features/topik/MarkedWordsProvider";
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
  const session = useTopikSession(profile?.id ?? "", section, from, to);

  return (
    <MarkedWordsProvider>
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold">{t("topik.practice.title", { from, to })}</h1>
          <ExitButton />
        </div>
        {!profile ? null : session.isPending ? (
          <p className="text-muted-foreground">{t("common.loading")}</p>
        ) : session.isError ? (
          <p className="text-destructive">{t("common.loadError")}</p>
        ) : session.data.questions.length === 0 ? (
          <NothingDue profileId={profile.id} section={section} from={from} to={to} />
        ) : (
          <TopikSession key={session.dataUpdatedAt} profileId={profile.id} questions={session.data.questions} />
        )}
      </section>
    </MarkedWordsProvider>
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
function NothingDue({ profileId, section, from, to }: { profileId: string; section: TopikSection; from: number; to: number }) {
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
    </div>
  );
}

/** "Thoát": confirms first when there are still marked-but-not-yet-added words (M6.3), so a
 * careless exit doesn't silently drop them (the list lives only in memory for this session). Also
 * warns on an actual tab close/reload via `beforeunload`. */
function ExitButton() {
  const { t } = useTranslation();
  const { marked } = useMarkedWords();
  const hasUnsaved = marked.length > 0;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => hasUnsaved && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsaved]);

  return (
    <>
      <LinkButton to="/topik" variant="outline">
        <X aria-hidden />
        {t("topik.practice.exit")}
      </LinkButton>
      <AlertDialog open={blocker.state === "blocked"} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("topik.practice.exitConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("topik.practice.exitConfirm.description", { count: marked.length })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              {t("topik.practice.exitConfirm.leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
