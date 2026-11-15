import { useTranslation } from "react-i18next";
import type { TopikTestSitting } from "@shared/topik";
import { CHART_BOX, CHART_PAD, scoreChart, type TopikTestKind } from "./scoreChart";

/**
 * One section's score trend (M7.29): percent against time, original papers in one colour and
 * mixed ones in another.
 *
 * Hand-written SVG on purpose — a chart library would be a dependency, a bundle and a theme to
 * fight for something that is a polyline and a few circles. The `viewBox` does the responsive
 * work, so the same drawing fits a 375 px phone and a desktop column without a resize listener.
 */

/** Tailwind stroke/fill colours per kind; the legend reads from the same place as the lines. */
const KIND_COLOR: Record<TopikTestKind, string> = {
  original: "text-sky-600 dark:text-sky-400",
  mixed: "text-amber-600 dark:text-amber-400",
};

export function TopikScoreChart({ sittings }: { sittings: TopikTestSitting[] }) {
  const { t, i18n } = useTranslation();
  const { series, grid, from, to } = scoreChart(sittings);
  if (series.length === 0) return null;

  const day = (at: number) => new Date(at).toLocaleDateString(i18n.resolvedLanguage, { month: "numeric", day: "numeric" });

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${CHART_BOX.width} ${CHART_BOX.height}`}
        className="h-auto w-full"
        role="img"
        aria-label={t("topik.history.chartLabel")}
      >
        {grid.map((line) => (
          <g key={line.percent} className="text-muted-foreground">
            <line
              x1={CHART_PAD.left}
              x2={CHART_BOX.width - CHART_PAD.right}
              y1={line.y}
              y2={line.y}
              stroke="currentColor"
              strokeWidth={0.5}
              opacity={0.4}
            />
            <text x={CHART_PAD.left - 4} y={line.y + 3} textAnchor="end" fontSize={9} fill="currentColor">
              {line.percent}
            </text>
          </g>
        ))}

        {/* Only the two ends are dated: with the x axis on real time, labelling every sitting
            overlaps the moment two of them fall in the same week. */}
        <g className="text-muted-foreground" fontSize={9} fill="currentColor">
          <text x={CHART_PAD.left} y={CHART_BOX.height - 4}>
            {day(from)}
          </text>
          {to !== from && (
            <text x={CHART_BOX.width - CHART_PAD.right} y={CHART_BOX.height - 4} textAnchor="end">
              {day(to)}
            </text>
          )}
        </g>

        {series.map((s) => (
          <g key={s.kind} className={KIND_COLOR[s.kind]}>
            {s.dots.length > 1 && <polyline points={s.polyline} fill="none" stroke="currentColor" strokeWidth={2} />}
            {s.dots.map((d) => (
              <circle key={d.id} cx={d.x} cy={d.y} r={3.5} fill="currentColor" />
            ))}
          </g>
        ))}
      </svg>

      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {series.map((s) => (
          <li key={s.kind} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2.5 rounded-full bg-current ${KIND_COLOR[s.kind]}`} />
            {t(s.kind === "mixed" ? "topik.test.mixedLabel" : "topik.history.kindOriginal")}
          </li>
        ))}
      </ul>
    </div>
  );
}
