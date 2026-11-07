import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";
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
import { useMarkedWords } from "./markedWords";

/**
 * Asks before leaving with words still marked but not yet added (M6.3, shared with a sitting's
 * result screen in M7.12).
 *
 * The list of marks lives only in memory for this session, so walking away loses it with nothing
 * to show for the marking. Covers in-app navigation (`useBlocker`) and an actual tab close or
 * reload (`beforeunload`). Renders nothing but the dialog, so a screen can place it anywhere.
 *
 * Only one of these per screen: React Router keeps a single blocker at a time.
 */
export function UnsavedMarksGuard() {
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
  );
}
