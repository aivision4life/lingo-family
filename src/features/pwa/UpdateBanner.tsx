import { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Registers the service worker (production build only: main.tsx renders this only then) and shows
 * "New version — Reload" once a new worker has taken over.
 *
 * The new worker activates by itself (`registerType: "autoUpdate"` + `skipWaiting()` in src/sw.ts),
 * so this banner no longer gates the update — nothing here can leave a new version stuck waiting.
 * Passing `onNeedReload` is what stops vite-plugin-pwa from reloading the page on its own: the
 * reload stays the user's choice, so an update cannot interrupt a review or TOPIK session in
 * progress. Ignoring the banner is safe too; the next time the app is opened it loads the new shell.
 *
 * The update check runs every hour and whenever the app comes back to the foreground — on a phone
 * the app is usually resumed rather than reloaded, and background timers are throttled, so the
 * hourly check alone can go days without firing.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const [newVersion, setNewVersion] = useState(false);

  useRegisterSW({
    onNeedReload() {
      setNewVersion(true);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => undefined);
      };
      setInterval(check, HOUR_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });

  if (!newVersion) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border bg-background p-3 shadow-lg"
      style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <span className="flex-1 text-sm">{t("pwa.update.message")}</span>
      <Button size="sm" onClick={() => window.location.reload()}>
        {t("pwa.update.reload")}
      </Button>
    </div>
  );
}
