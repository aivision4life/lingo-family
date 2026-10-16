import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TopikQuestion } from "@shared/topik";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { useCreateTopikQuestion, useUpdateTopikQuestion } from "@/features/topik/api";
import { topikErrorMessage } from "@/features/topik/errors";
import { emptyTopikFormValues, topikFormValuesFromQuestion, type TopikFormValues } from "@/features/topik/formValues";
import { TopikQuestionForm } from "@/features/topik/TopikQuestionForm";
import { TopikQuestionList } from "@/features/topik/TopikQuestionList";

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; question: TopikQuestion };

/** Screen (M6.1) — `/topik/manage`: review imported questions, add/edit/delete by hand. Adults
 * only. Filtering/search/pagination (M6.4-ish scaling, as the bank grows toward ~600+ rows) lives
 * in `TopikQuestionList`; this page only switches between that list and the create/edit form. */
export function TopikManagePage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [mode, setMode] = useState<Mode>({ kind: "list" });

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
      {mode.kind === "list" ? (
        <TopikQuestionList
          profileId={profile.id}
          onAddNew={() => setMode({ kind: "create" })}
          onEdit={(question) => setMode({ kind: "edit", question })}
        />
      ) : (
        <QuestionEditor
          profileId={profile.id}
          question={mode.kind === "edit" ? mode.question : null}
          onDone={() => setMode({ kind: "list" })}
        />
      )}
    </PageShell>
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
