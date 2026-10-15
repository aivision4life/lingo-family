import { Camera, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Profile } from "@shared/profile";
import { Button } from "@/components/ui/button";
import { resizeForUpload } from "@/features/images/resize";
import { useRemoveAvatarPhoto, useUploadAvatarPhoto } from "./api";
import { ProfileAvatar } from "./ProfileAvatar";

type Props = {
  profile: Profile;
  /** The managing adult making the change (may be a different profile than `profile`). */
  actorId: string;
};

/** "My photo" for a profile avatar (M2.10, edit mode only): the emoji (`AvatarPicker`) stays as a fallback. */
export function AvatarPhotoControl({ profile, actorId }: Props) {
  const { t } = useTranslation();
  const upload = useUploadAvatarPhoto();
  const remove = useRemoveAvatarPhoto();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = upload.isPending || remove.isPending;

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const blob = await resizeForUpload(f);
      upload.mutate({ id: profile.id, actorId, blob }, { onError: () => setError(t("images.invalidUpload")) });
    } catch {
      setError(t("images.invalidUpload"));
    }
  };

  return (
    <div className="flex items-center gap-4">
      <span className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted text-4xl">
        <ProfileAvatar profile={profile} variant="tile" />
      </span>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => file.current?.click()}>
            <Camera aria-hidden />
            {t("profiles.form.changePhoto")}
          </Button>
          {profile.avatar_photo && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => remove.mutate({ id: profile.id, actorId }, { onError: () => setError(t("profiles.errors.generic")) })}
            >
              <Trash2 aria-hidden />
              {t("profiles.form.removePhoto")}
            </Button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }}
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
