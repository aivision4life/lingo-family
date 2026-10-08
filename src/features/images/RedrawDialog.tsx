import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { imagePromptTextSchema } from "@shared/image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrompt: string;
  pending: boolean;
  onSubmit: (prompt: string) => void;
};

/** "Redraw": edit the English scene description; the drawing style is appended by the server. */
export function RedrawDialog({ open, onOpenChange, ...form }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("images.redrawTitle")}</DialogTitle>
          <DialogDescription>{t("images.promptHint")}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the field starts from the current prompt every time. */}
        <RedrawForm {...form} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type FormProps = Omit<Props, "open" | "onOpenChange"> & { onCancel: () => void };

function RedrawForm({ initialPrompt, pending, onSubmit, onCancel }: FormProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [prompt, setPrompt] = useState(initialPrompt);
  const valid = imagePromptTextSchema.safeParse(prompt).success;
  return (
    <>
      <label htmlFor={fieldId} className="text-sm font-medium">
        {t("images.promptLabel")}
      </label>
      <textarea
        id={fieldId}
        lang="en"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        maxLength={400}
        className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button disabled={!valid || pending} onClick={() => onSubmit(prompt.trim())}>
          {pending ? t("images.drawing") : t("images.redrawSubmit")}
        </Button>
      </DialogFooter>
    </>
  );
}
