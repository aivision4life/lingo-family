import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { TopikSection } from "@shared/enums";
import type { TopikTestLength, TopikTestOption } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useCreateTopikTest, useTopikTestOptions } from "@/features/topik/api";
import { cn } from "@/lib/utils";

/**
 * Screen (M6.4) — `/topik/tests`: pick a paper and how much of it to sit.
 *
 * Only listening for now. A length the paper cannot fill is shown greyed with the reason rather
 * than hidden: "this exists, it is not ready yet" is the true state of a paper still being typed
 * up, and hiding it would look like the feature is missing.
 */
export function TopikTestPickerPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const section: TopikSection = "listening";
  const options = useTopikTestOptions(profile?.id ?? "", section);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">{t("topik.test.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("topik.test.intro")}</p>
      {!profile ? null : options.isPending ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : options.isError ? (
        <p className="text-destructive">{t("common.loadError")}</p>
      ) : options.data.length === 0 ? (
        <p className="text-muted-foreground">{t("topik.test.noPapers")}</p>
      ) : (
        options.data.map((paper) => <PaperCard key={paper.exam} paper={paper} profileId={profile.id} section={section} />)
      )}
    </section>
  );
}

function PaperCard({ paper, profileId, section }: { paper: TopikTestOption; profileId: string; section: TopikSection }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateTopikTest();
  const [failed, setFailed] = useState(false);

  const start = (length: TopikTestLength) => {
    setFailed(false);
    create.mutate(
      { profile_id: profileId, section, exam: paper.exam, length },
      {
        onSuccess: (test) => void navigate(`/topik/tests/${test.id}`),
        onError: () => setFailed(true),
      },
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold" lang="ko">
          {paper.exam}
        </h2>
        <span className="text-sm text-muted-foreground">{t("topik.test.readyCount", { count: paper.ready_questions })}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {paper.lengths.map((option) => (
          <div key={String(option.length)} className="flex flex-col gap-1">
            <Button
              type="button"
              variant={option.available ? "default" : "outline"}
              disabled={!option.available || create.isPending}
              className={cn(!option.available && "opacity-50")}
              onClick={() => start(option.length)}
            >
              {option.length === "full"
                ? t("topik.test.lengthFull", { count: option.questions })
                : t("topik.test.lengthN", { count: option.questions })}
            </Button>
            {!option.available && (
              <span className="max-w-32 text-xs text-muted-foreground">
                {paper.contiguous
                  ? t("topik.test.tooFewQuestions", { count: paper.ready_questions })
                  : t("topik.test.notContiguous")}
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        {paper.history.length === 0
          ? t("topik.test.neverTaken")
          : t("topik.test.history", {
              count: paper.history.length,
              scores: paper.history.map((h) => `${h.score_points}/${h.total_points}`).join(", "),
            })}
      </p>
      {failed && <p className="text-sm text-destructive">{t("topik.test.startFailed")}</p>}
    </div>
  );
}
