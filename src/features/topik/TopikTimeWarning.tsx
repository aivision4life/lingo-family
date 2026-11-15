import { useTranslation } from "react-i18next";
import { READING_WARNING_MS } from "./readingClock";
import { Button } from "@/components/ui/button";
import type { SittingClock } from "./useTestClock";

/**
 * The last minutes of a reading paper (M7.11), and the one way out of them (M7.31).
 *
 * A banner that stays rather than a toast that flashes past — and beside it the only control that
 * can add time. The button is here and nowhere else on purpose: five more minutes is a decision
 * taken at the end of a paper, with the warning in front of you, not something available from the
 * start. It may be pressed again and again, each press worth another five minutes, and the server
 * grants each one (the client adds nothing, see `useTestClock`).
 *
 * Only for the reading section: a listening paper is paced by its recording, and moving its
 * deadline would not make the tape any longer.
 */
export function TopikTimeWarning({ clock }: { clock: SittingClock }) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 dark:bg-amber-950/40"
    >
      <p className="text-sm font-medium">{t("topik.test.lastMinutes", { minutes: READING_WARNING_MS / 60_000 })}</p>
      <Button type="button" variant="outline" size="sm" onClick={clock.extend} disabled={!clock.canExtend}>
        {t("topik.test.extend", { minutes: clock.extensionStepMinutes })}
      </Button>
    </div>
  );
}
