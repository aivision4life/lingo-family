import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { albumErrorKey, useAddToAlbum, useAlbums } from "./api";
import { CreateAlbumDialog } from "./CreateAlbumDialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  lang: LearnLang;
  wordIds: string[];
  /** Called after the words were added (the caller leaves selection mode). */
  onDone: () => void;
};

/** Library "Add to album": pick one album of the words' language, or create a new one. */
export function AddToAlbumDialog({ open, onOpenChange, profileId, lang, wordIds, onDone }: Props) {
  const { t } = useTranslation();
  const albums = useAlbums(lang);
  const add = useAddToAlbum();
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const list = albums.data?.albums ?? [];

  const addTo = (albumId: string) =>
    add.mutate(
      { profileId, albumId, wordIds },
      {
        onSuccess: () => {
          onOpenChange(false);
          onDone();
        },
      },
    );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("albums.addTo.title")}</DialogTitle>
            <DialogDescription>{t("albums.addTo.hint", { count: wordIds.length, lang: t(`langs.${lang}`) })}</DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {list.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  aria-pressed={picked === a.id}
                  onClick={() => setPicked(a.id)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    picked === a.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
                  )}
                >
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 text-xs opacity-80">{t("albums.wordCount", { count: a.word_count })}</span>
                </button>
              </li>
            ))}
            {list.length === 0 && !albums.isPending && <li className="text-sm text-muted-foreground">{t("albums.noneForLang")}</li>}
          </ul>
          <Button type="button" variant="outline" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t("albums.newAlbum")}
          </Button>
          {add.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t(albumErrorKey(add.error))}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={!picked || add.isPending} onClick={() => picked && addTo(picked)}>
              {t("albums.addTo.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* A new album is created, then the selected words go straight into it. */}
      <CreateAlbumDialog
        open={creating}
        onOpenChange={setCreating}
        profileId={profileId}
        defaultLang={lang}
        lockLang
        onCreated={(id) => addTo(id)}
      />
    </>
  );
}
