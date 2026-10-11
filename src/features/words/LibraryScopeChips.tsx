import { useTranslation } from "react-i18next";
import { LIBRARY_SCOPES, type LibraryScope } from "@shared/enums";
import { cn } from "@/lib/utils";

type Props = { value: LibraryScope; onChange: (scope: LibraryScope) => void };

/** "I'm learning" | "I added" | "All" — the library filter relative to the active profile (M2.7). */
export function LibraryScopeChips({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("words.scope.label")} className="flex gap-2">
      {LIBRARY_SCOPES.map((scope) => (
        <button
          key={scope}
          type="button"
          aria-pressed={value === scope}
          onClick={() => onChange(scope)}
          className={cn(
            "min-h-11 flex-1 rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            value === scope ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
          )}
        >
          {t(`words.scope.${scope}`)}
        </button>
      ))}
    </div>
  );
}
