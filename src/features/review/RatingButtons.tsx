import { useTranslation } from "react-i18next";
import type { Grade } from "ts-fsrs";
import { cn } from "@/lib/utils";
import { intervalLabel } from "./formatInterval";

const RATINGS: { grade: Grade; key: "again" | "hard" | "good" | "easy"; tone: string }[] = [
  { grade: 1, key: "again", tone: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100" },
  { grade: 2, key: "hard", tone: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100" },
  { grade: 3, key: "good", tone: "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/50 dark:text-green-100" },
  { grade: 4, key: "easy", tone: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100" },
];

type Props = {
  /** Milliseconds until due again, per rating (from previewIntervals). */
  intervals: Record<Grade, number>;
  disabled: boolean;
  onRate: (grade: Grade) => void;
};

/** Again / Hard / Good / Easy, large for phones, with the expected interval under each. Keys 1–4. */
export function RatingButtons({ intervals, disabled, onRate }: Props) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-4 gap-2">
      {RATINGS.map(({ grade, key, tone }) => {
        const label = intervalLabel(intervals[grade]);
        return (
          <button
            key={grade}
            type="button"
            disabled={disabled}
            onClick={() => onRate(grade)}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center rounded-xl border px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
              tone,
            )}
          >
            <span className="text-base font-semibold">{t(`review.ratings.${key}`)}</span>
            <span className="text-xs opacity-80">{t(`review.interval.${label.key}`, { count: label.count })}</span>
            <span className="sr-only">({grade})</span>
          </button>
        );
      })}
    </div>
  );
}
