import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AlbumRef } from "@shared/album";
import type { LearnLang } from "@shared/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { albumErrorKey, useAlbums, useSetWordAlbums } from "./api";
import { AlbumTickList } from "./AlbumTickList";

type Props = { wordId: string; lang: LearnLang; current: AlbumRef[]; profileId: string };

/** Word detail: the "Album" button and its dialog (tick the albums the word belongs to). */
export function WordAlbumsButton(props: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <FolderPlus aria-hidden />
        {t("albums.button")}
        {props.current.length > 0 && <span className="text-muted-foreground">({props.current.length})</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("albums.wordDialog.title")}</DialogTitle>
            <DialogDescription>{t("albums.wordDialog.hint", { lang: t(`langs.${props.lang}`) })}</DialogDescription>
          </DialogHeader>
          {/* Mounted only while open, so the ticks start from the word's current albums. */}
          {open && <TickForm {...props} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TickForm({ wordId, lang, current, profileId, onClose }: Props & { onClose: () => void }) {
  const { t } = useTranslation();
  const albums = useAlbums(lang);
  const save = useSetWordAlbums(wordId);
  const [ticked, setTicked] = useState<string[]>(() => current.map((a) => a.id));

  return (
    <>
      <AlbumTickList albums={albums.data?.albums ?? []} loading={albums.isPending} ticked={ticked} onChange={setTicked} />
      {save.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(albumErrorKey(save.error))}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate({ profileId, albumIds: ticked }, { onSuccess: onClose })}>
          {t("albums.wordDialog.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
