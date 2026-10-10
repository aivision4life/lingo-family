import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useUsage } from "./api";

/** Settings: today's quota use — family pictures, this profile's pictures, LLM and TTS calls. */
export function UsageCard({ profileId }: { profileId: string }) {
  const { t, i18n } = useTranslation();
  const usage = useUsage(profileId);
  if (!usage.data) return null;
  const { family, profile, llm_last } = usage.data;
  const rows = [
    { label: t("images.usage.familyImages"), used: family.image, limit: family.image_cap },
    { label: t("images.usage.profileImages"), used: profile.image, limit: profile.image_limit },
    { label: t("images.usage.llm"), used: profile.llm, limit: profile.llm_limit },
    { label: t("images.usage.tts"), used: profile.tts, limit: profile.tts_limit },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">{t("images.usage.title")}</h2>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2 text-sm">
              <span>{r.label}</span>
              <span className="tabular-nums">
                {r.used}/{r.limit}
              </span>
            </div>
            <div
              role="meter"
              aria-label={r.label}
              aria-valuemin={0}
              aria-valuemax={r.limit}
              aria-valuenow={r.used}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={r.used >= r.limit ? "h-full bg-destructive" : "h-full bg-primary"}
                style={{ width: `${Math.min(100, (r.used / r.limit) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("images.usage.note")}</p>
      {/* Settings is adult-only, so this status line is too. */}
      <p role="status" className={cn("text-xs", llm_last?.fallback ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        {llm_last
          ? t("images.usage.aiStatus", {
              model: llm_last.model,
              role: t(llm_last.fallback ? "images.usage.aiFallback" : "images.usage.aiPrimary"),
              time: new Date(llm_last.at).toLocaleString(i18n.language),
            })
          : t("images.usage.aiNone")}
      </p>
    </section>
  );
}
