import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

type Props = {
  id: string;
  label: string;
  hint?: string;
  /** Translated error message; shown under the control when set. */
  error?: string;
  children: ReactNode;
};

/** Label + control + optional hint/error, stacked for mobile. */
export function FormField({ id, label, hint, error, children }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
