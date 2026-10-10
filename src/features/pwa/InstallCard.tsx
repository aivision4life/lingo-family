import { Download, Share, SquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { promptInstall, useInstallMode } from "./installPrompt";

/** Settings: install the app (a button where the browser allows it, steps for iPhone). */
export function InstallCard() {
  const { t } = useTranslation();
  const mode = useInstallMode();

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">{t("pwa.install.title")}</h2>
      {mode === "installed" && <p className="text-sm text-muted-foreground">{t("pwa.install.installed")}</p>}
      {mode === "prompt" && (
        <>
          <p className="text-sm text-muted-foreground">{t("pwa.install.intro")}</p>
          <Button type="button" onClick={() => void promptInstall()} className="self-start">
            <Download aria-hidden />
            {t("pwa.install.button")}
          </Button>
        </>
      )}
      {mode === "ios" && (
        <>
          <p className="text-sm text-muted-foreground">{t("pwa.install.iosIntro")}</p>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>
              {t("pwa.install.iosShare")} <Share aria-hidden className="inline size-4 align-text-bottom" />
            </li>
            <li>
              {t("pwa.install.iosAdd")} <SquarePlus aria-hidden className="inline size-4 align-text-bottom" />
            </li>
            <li>{t("pwa.install.iosConfirm")}</li>
          </ol>
          <p className="text-xs text-muted-foreground">{t("pwa.install.iosNote")}</p>
        </>
      )}
      {mode === "other" && <p className="text-sm text-muted-foreground">{t("pwa.install.other")}</p>}
    </section>
  );
}
