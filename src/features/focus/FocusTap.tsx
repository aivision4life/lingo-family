import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useOpenFocus } from "./focusContext";

type Props = { focusKey: string; text: string; className?: string; children: ReactNode };

/**
 * Makes its content open the Focus view when tapped (a plain wrapper when there is no Focus view
 * around, e.g. a screen that does not support it).
 */
export function FocusTap({ focusKey, text, className, children }: Props) {
  const { t } = useTranslation();
  const open = useOpenFocus();
  if (!open) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      aria-label={t("focus.open", { text })}
      onClick={() => open(focusKey)}
      className={cn("rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}
    >
      {children}
    </button>
  );
}
