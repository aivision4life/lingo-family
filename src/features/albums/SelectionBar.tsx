import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type Props = {
  count: number;
  total: number;
  onSelectAll: () => void;
  onDone: () => void;
  /** Hint under the bar, e.g. "select words of one language". */
  notice?: string | null;
  children: React.ReactNode;
};

/**
 * Contextual action bar while selecting words: fixed to the bottom, above the tab bar and the
 * floating "+", with the count, "Select all", the actions (children) and "Done".
 */
export function SelectionBar({ count, total, onSelectAll, onDone, notice, children }: Props) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t("albums.select.count", { count })}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">{t("albums.select.count", { count })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onSelectAll} disabled={count >= total}>
              {t("albums.select.all")}
            </Button>
            <Button size="sm" variant="outline" onClick={onDone}>
              {t("albums.select.done")}
            </Button>
          </div>
        </div>
        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    </div>
  );
}
