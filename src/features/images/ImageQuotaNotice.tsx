import { useTranslation } from "react-i18next";
import { nextUtcMidnight } from "./quotaReset";

/**
 * Shown wherever a draw was skipped because today's image quota (profile or family) is used up
 * (M2.8). The reset time is UTC midnight, shown in the viewer's own device time/locale.
 */
export function ImageQuotaNotice() {
  const { i18n, t } = useTranslation();
  const time = nextUtcMidnight().toLocaleString(i18n.language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      {t("images.quotaBanner", { time })}
    </p>
  );
}
