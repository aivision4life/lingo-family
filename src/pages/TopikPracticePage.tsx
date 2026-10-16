import { X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useSearchParams } from "react-router";
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
import { useTopikSession } from "@/features/topik/api";
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
  const session = useTopikSession(profile?.id ?? "", from, to);

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
          <p className="py-10 text-center text-lg">{t("topik.practice.nothingToday")}</p>
        ) : (
          <TopikSession key={session.dataUpdatedAt} profileId={profile.id} questions={session.data.questions} />
        )}
      </section>
    </MarkedWordsProvider>
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
