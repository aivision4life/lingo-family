import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Album } from "@shared/album";
import { cn } from "@/lib/utils";

type Props = {
  albums: Album[];
  ticked: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  /** Chips in a wrapping row (Add word screen) instead of a list (dialog). */
  chips?: boolean;
};

/** Tick any number of albums. Used by Word detail (dialog) and the Add word screen (chips). */
export function AlbumTickList({ albums, ticked, onChange, loading, chips }: Props) {
  const { t } = useTranslation();
  const toggle = (id: string) => onChange(ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id]);

  if (albums.length === 0) {
    return <p className="text-sm text-muted-foreground">{loading ? t("common.loading") : t("albums.noneForLang")}</p>;
  }
  return (
    <ul className={cn(chips ? "flex flex-wrap gap-2" : "flex max-h-72 flex-col gap-2 overflow-y-auto")}>
      {albums.map((a) => {
        const on = ticked.includes(a.id);
        return (
          <li key={a.id} className={chips ? undefined : "w-full"}>
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(a.id)}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                chips ? "" : "w-full",
                on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
              )}
            >
              {on && <Check aria-hidden className="size-4 shrink-0" />}
              <span className="truncate">{a.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
