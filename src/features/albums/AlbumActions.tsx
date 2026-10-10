import { Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ALBUM_NAME_MAX, albumNameSchema } from "@shared/album";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { albumErrorKey, useDeleteAlbum, useRenameAlbum } from "./api";

type Props = { profileId: string; id: string; name: string };

/** Adults: rename and delete an album (deleting never deletes its words). */
export function AlbumActions(props: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <RenameButton {...props} />
      <DeleteButton {...props} />
    </div>
  );
}

function RenameButton({ profileId, id, name }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden />
        {t("albums.rename.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("albums.rename.title")}</DialogTitle>
          </DialogHeader>
          {open && <RenameForm profileId={profileId} id={id} name={name} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RenameForm({ profileId, id, name, onClose }: Props & { onClose: () => void }) {
  const { t } = useTranslation();
  const fieldId = useId();
  const rename = useRenameAlbum();
  const [value, setValue] = useState(name);
  const parsed = albumNameSchema.safeParse(value);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.success) rename.mutate({ profileId, id, name: parsed.data }, { onSuccess: onClose });
      }}
    >
      <label htmlFor={fieldId} className="text-sm font-medium">
        {t("albums.create.name")}
      </label>
      <Input id={fieldId} value={value} maxLength={ALBUM_NAME_MAX} autoFocus onChange={(e) => setValue(e.target.value)} />
      {rename.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(albumErrorKey(rename.error))}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!parsed.success || rename.isPending}>
          {t("albums.rename.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteButton({ profileId, id, name }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const del = useDeleteAlbum();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className="text-destructive" disabled={del.isPending}>
          <Trash2 aria-hidden />
          {t("albums.delete.button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("albums.delete.title", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("albums.delete.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => del.mutate({ profileId, id }, { onSuccess: () => void navigate("/words?view=albums", { replace: true }) })}
          >
            {t("albums.delete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
