import { Camera, RefreshCw, Wand2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IMAGE_ERRORS, type ImageItemKind, type ImageState, type ImageView } from "@shared/image";
import { Button } from "@/components/ui/button";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { ApiError } from "@/lib/api";
import { useImageActions } from "./api";
import { RedrawDialog } from "./RedrawDialog";
import { resizeForUpload } from "./resize";

type Props = {
  kind: ImageItemKind;
  id: string;
  image: ImageView;
  /** Prefilled scene when the item has no image_prompt yet (e.g. its English meaning). */
  suggestion: string;
  /** Icon-only buttons (example sentences). */
  compact?: boolean;
};

/** Adults only: "Redraw" (edit the prompt), "My photo" (resize + upload), "Try again" when failed. */
export function ImageTools({ kind, id, image, suggestion, compact = false }: Props) {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const actions = useImageActions({ kind, id });
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  if (!profile || !canManageProfiles(profile)) return null;

  const busy = actions.retry.isPending || actions.redraw.isPending || actions.upload.isPending;
  const after = (s: ImageState) => setNotice(s.quota ? t("images.quota") : s.image_status === "failed" ? t("images.failed") : null);
  const onError = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : "";
    setNotice(
      code === IMAGE_ERRORS.invalidUpload ? t("images.invalidUpload")
      : code === IMAGE_ERRORS.notConfigured ? t("images.notConfigured")
      : t("words.errors.generic"),
    );
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setNotice(null);
    try {
      const blob = await resizeForUpload(f);
      actions.upload.mutate({ profileId: profile.id, blob }, { onSuccess: after, onError });
    } catch {
      setNotice(t("images.invalidUpload"));
    }
  };

  const hasImage = image.image_key !== null;
  const btn = compact ? ({ size: "icon", variant: "ghost" } as const) : ({ variant: "outline" } as const);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {image.image_status === "failed" && (
          <Button {...btn} disabled={busy} aria-label={t("images.retry")}
            onClick={() => actions.retry.mutate(profile.id, { onSuccess: after, onError })}>
            <RefreshCw aria-hidden className={actions.retry.isPending ? "animate-spin" : undefined} />
            {!compact && t("images.retry")}
          </Button>
        )}
        <Button {...btn} disabled={busy} aria-label={hasImage ? t("images.redraw") : t("images.draw")} onClick={() => setOpen(true)}>
          <Wand2 aria-hidden />
          {!compact && (hasImage ? t("images.redraw") : t("images.draw"))}
        </Button>
        <Button {...btn} disabled={busy} aria-label={t("images.upload")} onClick={() => file.current?.click()}>
          <Camera aria-hidden />
          {!compact && (actions.upload.isPending ? t("images.uploading") : t("images.upload"))}
        </Button>
        <input ref={file} type="file" accept="image/*" className="hidden"
          onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      <RedrawDialog
        open={open}
        onOpenChange={setOpen}
        initialPrompt={image.image_prompt ?? suggestion}
        pending={actions.redraw.isPending}
        onSubmit={(prompt) =>
          actions.redraw.mutate(
            { profileId: profile.id, prompt },
            { onSuccess: (s) => { setOpen(false); after(s); }, onError },
          )
        }
      />
    </div>
  );
}
