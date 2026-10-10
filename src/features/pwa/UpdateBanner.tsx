import { useRegisterSW } from "virtual:pwa-register/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Registers the service worker (production build only: main.tsx renders this only then) and shows
 * "New version — Reload" when a new worker is waiting. The update check runs every hour and is
 * skipped while offline.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) registration.update().catch(() => undefined);
      }, HOUR_MS);
    },
  });

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border bg-background p-3 shadow-lg"
      style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <span className="flex-1 text-sm">{t("pwa.update.message")}</span>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>
        {t("pwa.update.reload")}
      </Button>
    </div>
  );
}
