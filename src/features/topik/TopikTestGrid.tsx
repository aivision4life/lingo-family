import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * The question grid of a reading sitting (M7.11): every number at once, answered ones filled in,
 * tap to jump.
 *
 * On paper a reading section is flipped through freely — answer 7, skip 8, come back — and a
 * screen that only offers "next" and "previous" makes that a chore across 50 questions. The grid
 * is also the only honest answer to "how much is left": the countdown says how long, not how many.
 *
 * Eight columns of 40px fit a 360px phone (8 × 40 + 7 × 4 = 348), which is why the cells are
 * smaller than this project's 44px rule — the same deliberate exception the practice screen's
 * question strip already takes, and for the same reason: fifty targets have to be visible at once
 * or the thing they are for stops working.
 */
export function TopikTestGrid({
  positions,
  current,
  isAnswered,
  onJump,
}: {
  positions: number[];
  current: number;
  isAnswered: (position: number) => boolean;
  onJump: (position: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-8 gap-1" role="group" aria-label={t("topik.test.gridLabel")}>
        {positions.map((position) => {
          const done = isAnswered(position);
          const here = position === current;
          return (
            <button
              key={position}
              type="button"
              onClick={() => onJump(position)}
              aria-current={here ? "step" : undefined}
              aria-label={t(done ? "topik.test.gridAnswered" : "topik.test.gridUnanswered", { number: position })}
              className={cn(
                "flex h-10 items-center justify-center rounded-md border text-sm font-medium tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                here && "ring-2 ring-ring ring-offset-1",
                done ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {position}
            </button>
          );
        })}
      </div>
    </div>
  );
}
