import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { LearnLang } from "@shared/enums";
import { Button } from "@/components/ui/button";
import { LangChips } from "@/features/words/bits";
import { useAlbums } from "./api";
import { AlbumGrid } from "./AlbumGrid";
import { CreateAlbumDialog } from "./CreateAlbumDialog";

/** Library → "Albums" tab: language filter, "Create album" (adults) and the album grid. */
export function AlbumsTab({ profileId, canEdit, defaultLang }: { profileId: string; canEdit: boolean; defaultLang: LearnLang }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [lang, setLang] = useState<LearnLang | null>(null);
  const [creating, setCreating] = useState(false);
  const albums = useAlbums();

  return (
    <>
      {canEdit && (
        <Button type="button" size="lg" variant="outline" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          {t("albums.newAlbum")}
        </Button>
      )}
      <LangChips allowAll label={t("words.add.lang")} value={lang} onChange={setLang} />
      {albums.isPending && <p className="text-muted-foreground">{t("common.loading")}</p>}
      {albums.isError && <p className="text-destructive">{t("common.loadError")}</p>}
      {albums.data && <AlbumGrid data={albums.data} lang={lang} />}
      <CreateAlbumDialog
        open={creating}
        onOpenChange={setCreating}
        profileId={profileId}
        defaultLang={lang ?? defaultLang}
        onCreated={(id) => void navigate(`/albums/${id}`)}
      />
    </>
  );
}
