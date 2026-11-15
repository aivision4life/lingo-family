import { useTranslation } from "react-i18next";
import type { TopikQuestionHistoryView } from "@shared/topik";
import { cn } from "@/lib/utils";
import { priorLabel } from "./priorHistory";

/**
 * "Câu mới" / "2/4" beside a question (M7.30).
 *
 * Small and muted on purpose: during a sitting it sits above the question line, where it must not
 * compete with the paper or push the options down — and on the result screen it is context for the
 * tick beside it, not a second verdict. The numbers come from the server already frozen at the
 * moment the paper started; nothing here recomputes them.
 */
export function TopikPriorBadge({ prior, className }: { prior: TopikQuestionHistoryView; className?: string }) {
  const { t } = useTranslation();
  const label = priorLabel(prior);
  return (
    <span className={cn("text-xs text-muted-foreground tabular-nums", className)}>
      {label.kind === "new" ? (
        t("topik.test.priorNew")
      ) : (
        <>
          {/* "2/4" on screen, read out in full: a bare fraction is meaningless to a screen reader. */}
          <span className="sr-only">{t("topik.test.priorLabel", { correct: label.correct, attempts: label.attempts })}</span>
          <span aria-hidden>{t("topik.test.priorCount", { correct: label.correct, attempts: label.attempts })}</span>
        </>
      )}
    </span>
  );
}
