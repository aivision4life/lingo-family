import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { appNow, setDevDayOffset, useDevDayOffset } from "@/lib/devClock";

/** Dev-only: shift "today" to try review schedules. Not rendered in production builds. */
export function DevClockPanel() {
  const { t, i18n } = useTranslation();
  const offset = useDevDayOffset();
  if (!import.meta.env.DEV) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2 text-sm">
      <span className="font-medium">{t("review.dev.title")}</span>
      <span className="text-muted-foreground">
        {t("review.dev.today", { date: appNow().toLocaleDateString(i18n.resolvedLanguage) })}
      </span>
      <Button size="sm" variant="outline" onClick={() => setDevDayOffset(offset + 1)}>
        {t("review.dev.plus1")}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setDevDayOffset(offset + 7)}>
        {t("review.dev.plus7")}
      </Button>
      {offset !== 0 && (
        <Button size="sm" variant="ghost" onClick={() => setDevDayOffset(0)}>
          {t("review.dev.reset")}
        </Button>
      )}
    </div>
  );
}
