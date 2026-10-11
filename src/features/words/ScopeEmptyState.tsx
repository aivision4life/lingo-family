import { useTranslation } from "react-i18next";
import type { LibraryScope } from "@shared/enums";
import { Button } from "@/components/ui/button";

type Props = { scope: Exclude<LibraryScope, "all">; onViewAll: () => void };

/** Friendly empty state for scope "learning" / "mine": explains why, offers "View All". */
export function ScopeEmptyState({ scope, onViewAll }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-muted-foreground">{t(scope === "learning" ? "words.scope.emptyLearning" : "words.scope.emptyMine")}</p>
      <Button type="button" variant="outline" onClick={onViewAll}>
        {t("words.scope.viewAll")}
      </Button>
    </div>
  );
}
