import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isSwStateHealthy, swStateOf, type SwState } from "./swState";

/**
 * Which build is running, and whether the service worker is healthy. Shown at the bottom of
 * Settings so a deploy can be verified on a phone: the id must match the commit that was deployed,
 * and the service worker line must not say "waiting".
 */
export function BuildInfo() {
  const { t } = useTranslation();
  const [state, setState] = useState<SwState>(() =>
    swStateOf({ supported: "serviceWorker" in navigator, hasController: false, hasWaiting: false }),
  );

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      if (!("serviceWorker" in navigator)) return;
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
      if (cancelled) return;
      setState(
        swStateOf({
          supported: true,
          hasController: navigator.serviceWorker.controller !== null,
          hasWaiting: registrations.some((r) => r.waiting !== null),
        }),
      );
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-1 pt-2 text-center text-xs text-muted-foreground">
      <p>{t("pwa.build.id", { id: __BUILD_ID__ })}</p>
      <p className={isSwStateHealthy(state) ? undefined : "font-medium text-amber-600 dark:text-amber-500"}>
        {t("pwa.build.sw", { state: t(`pwa.build.swState.${state}`) })}
      </p>
    </div>
  );
}
