import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type LibraryView = "all" | "albums";

/** Segmented control at the top of the Library: "All | Albums". */
export function LibraryTabs({ value, onChange }: { value: LibraryView; onChange: (view: LibraryView) => void }) {
  const { t } = useTranslation();
  return (
    <div role="tablist" aria-label={t("albums.tabsLabel")} className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
      {(["all", "albums"] as const).map((view) => (
        <button
          key={view}
          type="button"
          role="tab"
          aria-selected={value === view}
          onClick={() => onChange(view)}
          className={cn(
            "min-h-11 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            value === view ? "bg-background shadow-sm" : "text-muted-foreground",
          )}
        >
          {t(`albums.tab.${view}`)}
        </button>
      ))}
    </div>
  );
}
