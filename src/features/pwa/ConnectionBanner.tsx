import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { dismissConnectionLost, useConnectionLost } from "@/lib/connection";

/** "Connection lost, try again": shown when the network (not the login session) failed. */
export function ConnectionBanner() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const lost = useConnectionLost();
  if (!lost) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-destructive/40 bg-background p-3 shadow-lg md:bottom-4"
    >
      <WifiOff aria-hidden className="size-5 shrink-0 text-destructive" />
      <span className="flex-1 text-sm">{t("pwa.connection.lost")}</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          dismissConnectionLost();
          void queryClient.refetchQueries({ type: "active" });
        }}
      >
        {t("pwa.connection.retry")}
      </Button>
    </div>
  );
}
