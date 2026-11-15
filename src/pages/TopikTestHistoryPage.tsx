import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { TOPIK_SECTIONS, type TopikSection } from "@shared/enums";
import { topikScorePercent, type TopikTestSitting } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/LinkButton";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useTopikTestHistory } from "@/features/topik/api";
import { TopikScoreChart } from "@/features/topik/TopikScoreChart";

/**
 * Screen (M7.29) — `/topik/tests/history`: every sitting this profile has submitted.
 *
 * It reads `topik_tests` and nothing else: a sitting already stores its range, its score and its
 * totals as they were at the time, so the history needs no table of its own.
 *
 * The filter lives in the URL (`?section=reading`), the way the picker's does, so a filtered
 * history survives a reload and can be bookmarked. With no filter both sections are listed, and
 * each gets its own chart — percentages of a listening paper and a reading one are two different
 * trends and one line through both would mean nothing.
 *
 * A row is a link to `/topik/tests/:id`, which is the result screen that already exists: that is
 * where the answers are, so this screen never duplicates them.
 */
export function TopikTestHistoryPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [params, setParams] = useSearchParams();
  const raw = params.get("section");
  const section: TopikSection | null = raw === "reading" || raw === "listening" ? raw : null;
  const history = useTopikTestHistory(profile?.id ?? "", section);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">{t("topik.history.title")}</h1>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("topik.test.sectionLabel")}>
        {([null, ...TOPIK_SECTIONS] as const).map((value) => (
          <Button
            key={value ?? "all"}
            type="button"
            variant={section === value ? "default" : "outline"}
            aria-pressed={section === value}
            onClick={() => setParams(value ? { section: value } : {}, { replace: true })}
          >
            {value ? t(`topik.section.${value}`) : t("topik.history.allSections")}
          </Button>
        ))}
      </div>

      {!profile ? null : history.isPending ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : history.isError ? (
        <p className="text-destructive">{t("common.loadError")}</p>
      ) : history.data.sittings.length === 0 ? (
        <p className="text-muted-foreground">{t("topik.history.empty")}</p>
      ) : (
        <>
          {/* One chart per section that has sittings — so the unfiltered view shows both. */}
          {TOPIK_SECTIONS.filter((s) => history.data.sittings.some((h) => h.section === s)).map((s) => (
            <div key={s} className="flex flex-col gap-2 rounded-lg border p-4">
              <h2 className="font-semibold">{t("topik.history.chartTitle", { section: t(`topik.section.${s}`) })}</h2>
              <TopikScoreChart sittings={history.data.sittings.filter((h) => h.section === s)} />
            </div>
          ))}

          <ul className="flex flex-col gap-2">
            {history.data.sittings.map((sitting) => (
              <li key={sitting.id}>
                <SittingRow sitting={sitting} />
              </li>
            ))}
          </ul>
        </>
      )}

      <LinkButton to="/topik/tests" variant="outline" className="self-start">
        {t("topik.test.backToPicker")}
      </LinkButton>
    </section>
  );
}

/** One sitting. The whole row is the tap target (≥ 44 px tall), not a small link inside it. */
function SittingRow({ sitting }: { sitting: TopikTestSitting }) {
  const { t, i18n } = useTranslation();
  const percent = topikScorePercent(sitting.score_points, sitting.total_points);
  const when = new Date(sitting.finished_at).toLocaleString(i18n.resolvedLanguage, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link
      to={`/topik/tests/${sitting.id}`}
      className="flex min-h-11 flex-col gap-1 rounded-lg border p-3 active:bg-accent hover:bg-accent"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="font-medium">
          {t(`topik.section.${sitting.section}`)}
          {" · "}
          {sitting.kind === "mixed" ? (
            t("topik.test.mixedLabel")
          ) : (
            <span lang="ko">{sitting.source_exam ?? t("topik.history.kindOriginal")}</span>
          )}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {t("topik.history.scoreAndPercent", { score: sitting.score_points, total: sitting.total_points, percent })}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
        <span>{when}</span>
        {sitting.from_number !== null && sitting.to_number !== null && (
          <span>{t("topik.history.range", { from: sitting.from_number, to: sitting.to_number })}</span>
        )}
      </div>
    </Link>
  );
}
