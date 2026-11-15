// Geometry for the history screen's score chart (M7.29), kept out of the component so the one
// thing that can be wrong here — where a dot lands — is testable without rendering anything.
//
// There is no chart library (and none is wanted): the whole chart is one `<svg>` with a polyline
// and a circle per sitting, which is all a trend over a handful of sittings needs.
import { topikScorePercent, type TopikTestSitting } from "@shared/topik";
import { TOPIK_TEST_KINDS } from "@shared/enums";

/** "original" | "mixed" — the sitting row is the only place this distinction is stored. */
export type TopikTestKind = TopikTestSitting["kind"];

/** Drawing box in SVG user units; the `<svg>` itself scales to the phone's width. */
export const CHART_BOX = { width: 320, height: 160 } as const;
/** Room for the percent labels on the left and the first/last date underneath. */
export const CHART_PAD = { left: 30, right: 10, top: 10, bottom: 18 } as const;
/** 0 / 50 / 100 is enough to read a percentage off; more lines only crowd a 375 px screen. */
export const CHART_GRID = [0, 50, 100] as const;

/** Original papers and mixed ones are two separate lines, so one row of colours decides both. */
export const CHART_KINDS: readonly TopikTestKind[] = TOPIK_TEST_KINDS;

/** `extended` = the sitting was given extra time (M7.31), so its dot is drawn hollow: it is still
 * on the trend, because it happened, but it was not sat in the paper's own time. */
export type ChartDot = { id: string; x: number; y: number; percent: number; at: number; extended: boolean };
export type ChartSeries = { kind: TopikTestKind; dots: ChartDot[]; polyline: string };
export type ChartGrid = { percent: number; y: number };
export type ScoreChart = { series: ChartSeries[]; grid: ChartGrid[]; from: number; to: number };

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Lays the sittings out on a percent-against-time chart.
 *
 * The x axis is real time, not the position in the list: two sittings a month apart must not look
 * like two on the same evening, which is the whole point of a trend. When every sitting shares one
 * timestamp (or there is only one) the span is zero, so they all sit in the middle of the box —
 * the alternative, dividing by zero, puts them nowhere at all.
 *
 * `sittings` may be in any order; each series is drawn oldest to newest.
 */
export function scoreChart(sittings: readonly TopikTestSitting[]): ScoreChart {
  const sorted = [...sittings].sort((a, b) => a.finished_at - b.finished_at);
  const innerW = CHART_BOX.width - CHART_PAD.left - CHART_PAD.right;
  const innerH = CHART_BOX.height - CHART_PAD.top - CHART_PAD.bottom;
  const from = sorted[0]?.finished_at ?? 0;
  const to = sorted[sorted.length - 1]?.finished_at ?? 0;
  const span = to - from;

  const x = (at: number) => round(span === 0 ? CHART_PAD.left + innerW / 2 : CHART_PAD.left + ((at - from) / span) * innerW);
  const y = (percent: number) => round(CHART_PAD.top + (1 - percent / 100) * innerH);

  const series = CHART_KINDS.map((kind) => {
    const dots = sorted
      .filter((s) => s.kind === kind)
      .map((s) => {
        const percent = topikScorePercent(s.score_points, s.total_points);
        return { id: s.id, x: x(s.finished_at), y: y(percent), percent, at: s.finished_at, extended: s.extension_ms > 0 };
      });
    return { kind, dots, polyline: dots.map((d) => `${d.x},${d.y}`).join(" ") };
  }).filter((s) => s.dots.length > 0);

  return { series, grid: CHART_GRID.map((percent) => ({ percent, y: y(percent) })), from, to };
}
