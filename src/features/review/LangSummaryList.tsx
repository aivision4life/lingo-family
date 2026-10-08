import { CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { useReviewSummary } from "./api";

/** One row per learning language: due/new counts and a "Start review" button. */
export function LangSummaryList({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  const summary = useReviewSummary(profileId);

  if (summary.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (summary.isError) return <p className="text-destructive">{t("common.loadError")}</p>;
  if (summary.data.length === 0) return <p className="text-muted-foreground">{t("review.noLangs")}</p>;

  return (
    <ul className="flex flex-col gap-3">
      {summary.data.map(({ lang, due, new: fresh }) => (
        <li key={lang} className="flex items-center gap-3 rounded-xl border p-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-lg font-semibold">{t(`langs.${lang}`)}</span>
            <span className="text-sm text-muted-foreground">{t("review.counts", { due, new: fresh })}</span>
          </div>
          {due + fresh > 0 ? (
            <LinkButton to={`/review?lang=${lang}`}>{t("review.start")}</LinkButton>
          ) : (
            <CircleCheck className="size-6 text-green-600" aria-label={t("review.nothingToday")} />
          )}
        </li>
      ))}
    </ul>
  );
}
