import { useId } from "react";
import { useTranslation } from "react-i18next";
import { IMAGE_PROMPT_MAX } from "@shared/customItem";

type Props = { value: string; onChange: (value: string) => void };

/** The scene description of the picture (English), collapsed by default; the style is added by the server. */
export function ImagePromptField({ value, onChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <details className="rounded-lg border px-3 py-2">
      <summary className="min-h-9 cursor-pointer text-sm font-medium">{t("examples.imagePrompt.summary")}</summary>
      <div className="mt-2 flex flex-col gap-1">
        <textarea
          id={id}
          lang="en"
          value={value}
          maxLength={IMAGE_PROMPT_MAX}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          aria-label={t("examples.imagePrompt.summary")}
          className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">{t("examples.imagePrompt.hint")}</p>
      </div>
    </details>
  );
}
