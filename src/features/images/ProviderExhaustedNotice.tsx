import { useTranslation } from "react-i18next";

/**
 * Shown wherever a draw was skipped because Workers AI's own account-wide daily Neuron
 * allocation is used up (M2.9, error 4006) — separate from our own per-profile/family quota
 * (`ImageQuotaNotice`), so it gets its own distinct banner.
 */
export function ProviderExhaustedNotice() {
  const { t } = useTranslation();
  return (
    <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      {t("images.providerExhaustedBanner")}
    </p>
  );
}
