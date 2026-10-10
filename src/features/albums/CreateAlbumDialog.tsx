import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ALBUM_NAME_MAX, albumNameSchema } from "@shared/album";
import type { LearnLang } from "@shared/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LangChips } from "@/features/words/bits";
import { albumErrorKey, useCreateAlbum } from "./api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  /** Language preselected (the Library's language filter, or the language of the selected words). */
  defaultLang: LearnLang;
  /** Fix the language (creating an album for words that already have one). */
  lockLang?: boolean;
  onCreated?: (id: string, lang: LearnLang) => void;
};

/** Adults: create an album (name ≤ 60 characters + language). */
export function CreateAlbumDialog({ open, onOpenChange, ...form }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("albums.create.title")}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts with an empty name. */}
        <CreateForm {...form} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ profileId, defaultLang, lockLang, onCreated, onCancel }: Omit<Props, "open" | "onOpenChange"> & { onCancel: () => void }) {
  const { t } = useTranslation();
  const nameId = useId();
  const create = useCreateAlbum();
  const [name, setName] = useState("");
  const [lang, setLang] = useState<LearnLang>(defaultLang);
  const valid = albumNameSchema.safeParse(name).success;

  const submit = () => {
    const parsed = albumNameSchema.safeParse(name);
    if (!parsed.success) return;
    create.mutate(
      { profileId, name: parsed.data, lang },
      {
        onSuccess: ({ id }) => {
          onCreated?.(id, lang);
          onCancel();
        },
      },
    );
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={nameId} className="text-sm font-medium">
        {t("albums.create.name")}
      </label>
      <Input id={nameId} value={name} maxLength={ALBUM_NAME_MAX} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t("albums.create.placeholder")} />
      {!lockLang && <LangChips value={lang} onChange={(l) => l && setLang(l)} label={t("albums.create.lang")} />}
      {create.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(albumErrorKey(create.error))}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!valid || create.isPending}>
          {t("albums.create.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
