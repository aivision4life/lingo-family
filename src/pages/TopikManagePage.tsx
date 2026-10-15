import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TopikQuestion } from "@shared/topik";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import {
  useCreateTopikQuestion,
  useDeleteTopikQuestion,
  useTopikQuestions,
  useUpdateTopikQuestion,
  useVerifyTopikBulk,
} from "@/features/topik/api";
import { topikErrorMessage } from "@/features/topik/errors";
import { emptyTopikFormValues, topikFormValuesFromQuestion, type TopikFormValues } from "@/features/topik/formValues";
import { TopikQuestionForm } from "@/features/topik/TopikQuestionForm";

type Filter = "unverified" | "verified" | "all";

/** Screen (M6.1) — `/topik/manage`: review imported questions, add/edit/delete by hand. Adults only. */
export function TopikManagePage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [filter, setFilter] = useState<Filter>("unverified");
  const [mode, setMode] = useState<"list" | "create" | string>("list"); // "list" | "create" | a question id being edited
  const questions = useTopikQuestions(profile?.id ?? "", filter === "all" ? undefined : filter === "verified");

  if (!profile) return null;
  if (!canManageProfiles(profile)) {
    return (
      <PageShell title={t("topik.manage.title")}>
        <p>{t("profiles.kidNotAllowed")}</p>
      </PageShell>
    );
  }

  return (
    <PageShell title={t("topik.manage.title")}>
      {mode === "list" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {(["unverified", "verified", "all"] as const).map((f) => (
              <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
                {t(`topik.manage.filter.${f}`)}
              </Button>
            ))}
            <Button variant="secondary" size="sm" className="ms-auto" onClick={() => setMode("create")}>
              {t("topik.manage.addManual")}
            </Button>
          </div>
          {questions.isPending ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : questions.isError ? (
            <p className="text-destructive">{t("common.loadError")}</p>
          ) : questions.data.length === 0 ? (
            <p className="text-muted-foreground">{t("topik.manage.empty")}</p>
          ) : (
            <QuestionList profileId={profile.id} questions={questions.data} onEdit={setMode} />
          )}
        </>
      ) : (
        <QuestionEditor
          profileId={profile.id}
          question={mode === "create" ? null : (questions.data?.find((q) => q.id === mode) ?? null)}
          onDone={() => setMode("list")}
        />
      )}
    </PageShell>
  );
}

function QuestionList({ profileId, questions, onEdit }: { profileId: string; questions: TopikQuestion[]; onEdit: (id: string) => void }) {
  const { t } = useTranslation();
  const del = useDeleteTopikQuestion();
  const verifyBulk = useVerifyTopikBulk();

  const exams = [...new Set(questions.map((q) => q.exam))];
  return (
    <div className="flex flex-col gap-3">
      {exams.map((exam) => {
        const rows = questions.filter((q) => q.exam === exam);
        const anyUnverified = rows.some((q) => !q.verified);
        return (
          <div key={exam} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{exam}</h2>
              {anyUnverified && (
                <Button size="sm" variant="outline" disabled={verifyBulk.isPending} onClick={() => verifyBulk.mutate({ profile_id: profileId, exam })}>
                  {t("topik.manage.verifyGroup")}
                </Button>
              )}
            </div>
            {rows.map((q) => (
              <div key={q.id} className="flex items-start justify-between gap-2 rounded-md border p-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm text-muted-foreground">
                    #{q.number} {!q.verified && `· ${t("topik.manage.unverifiedBadge")}`} {q.warning && `· ⚠ ${q.warning}`}
                  </span>
                  <span lang="ko" className="truncate">{q.stem.text ?? t("topik.manage.imageOnly")}</span>
                  <span className="text-sm text-muted-foreground">{t("topik.manage.correctAnswer", { n: q.correct_option })}</span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(q.id)}>{t("topik.manage.edit")}</Button>
                  <Button size="sm" variant="destructive" disabled={del.isPending} onClick={() => del.mutate({ id: q.id, profile_id: profileId })}>
                    {t("topik.manage.delete")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function QuestionEditor({ profileId, question, onDone }: { profileId: string; question: TopikQuestion | null; onDone: () => void }) {
  const { t } = useTranslation();
  const create = useCreateTopikQuestion();
  const update = useUpdateTopikQuestion();
  const pending = create.isPending || update.isPending;
  // Remounts the form (fresh field state) after "Save and add next"; see formKey below.
  const [formKey, setFormKey] = useState(0);
  const [initial, setInitial] = useState<TopikFormValues>(() => (question ? topikFormValuesFromQuestion(question) : emptyTopikFormValues()));
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  return (
    <TopikQuestionForm
      key={formKey}
      profileId={profileId}
      initial={initial}
      submitting={pending}
      serverError={topikErrorMessage(create.error ?? update.error, t)}
      savedMessage={savedMessage}
      onSubmit={(input) => {
        setSavedMessage(null);
        if (question) {
          update.mutate({ id: question.id, profile_id: profileId, patch: { ...input, warning: null } }, { onSuccess: onDone });
        } else {
          create.mutate({ ...input, profile_id: profileId }, { onSuccess: onDone });
        }
      }}
      // Only for a brand-new question: saving an edit always returns to the list (onSubmit above).
      onSubmitAndNext={
        question
          ? undefined
          : (input) => {
              setSavedMessage(null);
              create.mutate(
                { ...input, profile_id: profileId },
                {
                  onSuccess: (saved) => {
                    setSavedMessage(t("topik.manage.form.savedN", { n: saved.number }));
                    setInitial({
                      ...emptyTopikFormValues(input.block),
                      exam: input.exam,
                      instruction: input.instruction ?? "",
                      number: String(input.number + 1),
                    });
                    setFormKey((k) => k + 1);
                  },
                },
              );
            }
      }
      footer={
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("common.back")}
        </Button>
      }
    />
  );
}
