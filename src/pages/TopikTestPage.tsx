import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import type { TopikTestResult, TopikTestRun as TopikTestRunData } from "@shared/topik";
import type { MarkedTerm } from "@/features/topik/markedWords";
import { LinkButton } from "@/components/LinkButton";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useTopikTest } from "@/features/topik/api";
import { MarkedWordsProvider } from "@/features/topik/MarkedWordsProvider";
import { readTestMarks, restoreTestMarks, writeTestMarks } from "@/features/topik/testMarks";
import { UnsavedMarksGuard } from "@/features/topik/UnsavedMarksGuard";
import { TopikTestResultView } from "@/features/topik/TopikTestResultView";
import { TopikTestRun } from "@/features/topik/TopikTestRun";

/**
 * Screen (M6.4) — `/topik/tests/:id`: one sitting, then its result at the same address.
 *
 * The server decides which of the two it is, by the test's status: a running test comes back
 * without any answers in it, a finished one comes back with everything. Keeping both on one URL
 * means the result survives a reload and can be reopened later from the picker's history.
 */
export function TopikTestPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const id = useParams().id ?? "";
  const test = useTopikTest(id, profile?.id ?? "");
  const [justFinished, setJustFinished] = useState<TopikTestResult | null>(null);
  const profileId = profile?.id ?? "";
  // Words marked on the result screen live on the device (M7.19): the result itself comes back
  // from the server after a reload, but the marking would be lost with nothing to show for it.
  // Read once per page view, so this screen never reads back what it has just written.
  const [savedMarks] = useState(() => (profileId ? readTestMarks(profileId) : null));
  const initialMarked = useMemo(() => restoreTestMarks(savedMarks, profileId, id), [savedMarks, profileId, id]);
  const persistMarks = useCallback((marked: MarkedTerm[]) => writeTestMarks(profileId, id, marked), [profileId, id]);

  if (!profile) return null;
  const level = profile.is_kid ? "kid" : "beginner";
  // Words are marked on the result screen and added from it (M7.12), so the list of marks lives
  // around that screen — never inside it, or re-rendering a row would drop them.
  if (justFinished)
    return (
      <Shell title={t("topik.test.resultTitle")}>
        <MarkedWordsProvider initialMarked={initialMarked} onChange={persistMarks}>
          <TopikTestResultView result={justFinished} profileId={profile.id} level={level} />
          <UnsavedMarksGuard />
        </MarkedWordsProvider>
      </Shell>
    );
  if (test.isPending) return <Shell title={t("topik.test.title")}>{<p className="text-muted-foreground">{t("common.loading")}</p>}</Shell>;
  // A cancelled sitting answers 410 on purpose (it must not hand over the answer key), so an
  // error here is the normal way to land on one — by reloading a tab left open on it, say.
  if (test.isError)
    return (
      <Shell title={t("topik.test.title")}>
        <p className="text-muted-foreground">{t("topik.test.abandonedNote")}</p>
        <LinkButton to="/topik/tests" variant="outline">
          {t("topik.test.backToPicker")}
        </LinkButton>
      </Shell>
    );

  if (test.data.status === "running") {
    // The two shapes share every field the heading needs; only this branch has `questions`.
    const running = test.data as TopikTestRunData;
    return (
      <Shell title={running.kind === "mixed" ? t("topik.test.mixedTitle") : t("topik.test.sittingTitle", { exam: running.source_exam ?? "" })}>
        <TopikTestRun test={running} profileId={profile.id} onFinished={setJustFinished} />
      </Shell>
    );
  }
  return (
    <Shell title={t("topik.test.resultTitle")}>
      <MarkedWordsProvider initialMarked={initialMarked} onChange={persistMarks}>
        <TopikTestResultView result={test.data as TopikTestResult} profileId={profile.id} level={level} />
        <UnsavedMarksGuard />
      </MarkedWordsProvider>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
    </section>
  );
}
