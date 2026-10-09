import { CircleCheck, Headphones, Image, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { useReviewSummary } from "./api";

const TYPE_ICONS = { recognition: Type, picture: Image, listening: Headphones } as const;

/** One row per learning language: due/new counts and a "Start review" button. */
export function LangSummaryList({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  const summary = useReviewSummary(profileId);

  if (summary.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (summary.isError) return <p className="text-destructive">{t("common.loadError")}</p>;
  if (summary.data.length === 0) return <p className="text-muted-foreground">{t("review.noLangs")}</p>;

  return (
    <ul className="flex flex-col gap-3">
      {summary.data.map(({ lang, due, new: fresh, by_type }) => (
        <li key={lang} className="flex items-center gap-3 rounded-xl border p-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-lg font-semibold">{t(`langs.${lang}`)}</span>
            <span className="text-sm text-muted-foreground">{t("review.counts", { due, new: fresh })}</span>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={t("review.byType")}>
              {(Object.keys(TYPE_ICONS) as (keyof typeof TYPE_ICONS)[]).map((type) => {
                const Icon = TYPE_ICONS[type];
                return (
                  <li key={type} className="flex items-center gap-1 text-muted-foreground">
                    <Icon aria-hidden className="size-4" />
                    {t(`review.typeShort.${type}`)} <b className="text-foreground">{by_type[type]}</b>
                  </li>
                );
              })}
            </ul>
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
