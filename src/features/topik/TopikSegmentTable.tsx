import { useTranslation } from "react-i18next";
import type { TopikSegment } from "@shared/topik";
import { cn } from "@/lib/utils";
import { formatDuration, metricsOf, type SegmentProblem, type SegmentWarning } from "./segmentEdit";

/**
 * Every clip of a paper as one row (M7.2), so 36 of them can be checked by eye in a minute instead
 * of by listening to each one.
 *
 * The answering pause is the column that matters most and the one that cannot be read off the three
 * stored timestamps at a glance, which is why it is derived here rather than left to the reader.
 * Tapping a row jumps to that clip's editor below.
 */
export function TopikSegmentTable({
  segments,
  problems,
  warnings,
}: {
  segments: readonly TopikSegment[];
  problems: readonly SegmentProblem[];
  warnings: readonly SegmentWarning[];
}) {
  const { t } = useTranslation();
  const ordered = [...segments].sort((a, b) => a.idx - b.idx);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("topik.audio.table.caption")}</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-2 font-medium">
                {t("topik.audio.table.idx")}
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                {t("topik.audio.field.start_ms")}
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                {t("topik.audio.field.end_ms")}
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                {t("topik.audio.table.length")}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t("topik.audio.table.pause")}
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((s) => {
              const { lengthMs, pauseMs } = metricsOf(s);
              const rowWarnings = warnings.filter((w) => w.segmentId === s.id);
              const broken = problems.some((p) => p.segmentId === s.id);
              const shortPause = rowWarnings.some((w) => w.code === "shortPause");
              const shortLength = rowWarnings.some((w) => w.code === "shortClip" || w.code === "shortLastClip");
              return (
                <tr
                  key={s.id}
                  className={cn(
                    "border-b last:border-0",
                    // A real problem outranks a warning: it is the one that blocks approval.
                    rowWarnings.length > 0 && !broken && "bg-amber-50 dark:bg-amber-950/40",
                    broken && "bg-destructive/10",
                  )}
                >
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    <a className="underline-offset-2 hover:underline" href={`#segment-${s.id}`}>
                      {s.idx}
                    </a>
                  </th>
                  <td className="py-1.5 pr-2 font-mono tabular-nums">{formatDuration(s.start_ms)}</td>
                  <td className="py-1.5 pr-2 font-mono tabular-nums">{formatDuration(s.end_ms)}</td>
                  <td
                    className={cn("py-1.5 pr-2 font-mono tabular-nums", shortLength && "font-semibold text-amber-700 dark:text-amber-400")}
                  >
                    {formatDuration(lengthMs)}
                  </td>
                  <td className={cn("py-1.5 font-mono tabular-nums", shortPause && "font-semibold text-amber-700 dark:text-amber-400")}>
                    {formatDuration(pauseMs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-500">
          {/* Ordered by how much they need acting on; "no question yet" is last because on a paper
              still being typed up it is the normal state of most clips. */}
          {(["shortPause", "shortClip", "shortLastClip", "noQuestion"] as const)
            .filter((code) => warnings.some((w) => w.code === code))
            .map((code) => (
              <li key={code}>
                {t("topik.audio.warningOn", {
                  numbers: ordered
                    .filter((s) => warnings.some((w) => w.segmentId === s.id && w.code === code))
                    .map((s) => s.idx)
                    .join(", "),
                  reason: t(`topik.audio.warning.${code}`),
                })}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
