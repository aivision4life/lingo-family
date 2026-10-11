import { ArrowLeft, ListChecks, Play } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { UNSORTED_ALBUM } from "@shared/album";
import { learnLangSchema, type LearnLang, type LibraryScope } from "@shared/enums";
import { showAddWordButton } from "@/components/layout/addWordVisibility";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { AddToAlbumDialog } from "@/features/albums/AddToAlbumDialog";
import { AlbumActions } from "@/features/albums/AlbumActions";
import { useAlbums, useRemoveFromAlbum } from "@/features/albums/api";
import { SelectionBar } from "@/features/albums/SelectionBar";
import { useWordSelection } from "@/features/albums/useWordSelection";
import { WordList } from "@/features/albums/WordList";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useWords } from "@/features/words/api";
import { readScope, writeScope } from "@/features/words/libraryScope";
import { LibraryScopeChips } from "@/features/words/LibraryScopeChips";
import { ScopeEmptyState } from "@/features/words/ScopeEmptyState";

/**
 * An album's words (`/albums/:id`), or the virtual "Unsorted" entry (`/albums/none?lang=ko`):
 * words that are in no album. Adults can rename / delete the album and select words to move.
 */
export function AlbumPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { profile } = useActiveProfile();
  const albums = useAlbums();
  const unsorted = id === UNSORTED_ALBUM;
  const unsortedLang = learnLangSchema.safeParse(params.get("lang"));
  const album = albums.data?.albums.find((a) => a.id === id);
  const lang: LearnLang | undefined = unsorted ? (unsortedLang.success ? unsortedLang.data : undefined) : album?.lang;
  // Library scope (M2.7), remembered per profile per device; also applies here and to "Unsorted".
  const [scope, setScope] = useState<LibraryScope>(() => (profile ? readScope(profile.id) : "learning"));
  const changeScope = (s: LibraryScope) => {
    setScope(s);
    if (profile) writeScope(profile.id, s);
  };
  const words = useWords({ album: id, lang: unsorted ? lang : undefined, scope, profileId: profile?.id });
  const sel = useWordSelection(words.data ?? []);
  const remove = useRemoveFromAlbum();
  const [adding, setAdding] = useState(false);

  if (!profile) return null;
  const canEdit = showAddWordButton(profile);
  const title = unsorted ? t("albums.unsorted") : (album?.name ?? t("pages.words.title"));
  const missing = !unsorted ? albums.isSuccess && !album : !unsortedLang.success;

  return (
    <PageShell title={title}>
      <Link to="/words?view=albums" className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-muted-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        {t("albums.tab.albums")}
      </Link>
      {missing && <p>{t("albums.notFound")}</p>}
      {!missing && lang && (
        <>
          <p className="text-sm text-muted-foreground">
            {t(`langs.${lang}`)} · {t("albums.wordCount", { count: words.data?.length ?? album?.word_count ?? 0 })}
          </p>
          {unsorted && <p className="text-sm text-muted-foreground">{t("albums.unsortedHint")}</p>}
          {!unsorted && (
            <div className="flex flex-wrap items-center gap-2">
              <LinkButton to={`/review?lang=${lang}&album=${id}`} variant="secondary">
                <Play aria-hidden />
                {t("review.start")}
              </LinkButton>
              {canEdit && <AlbumActions profileId={profile.id} id={id} name={album?.name ?? ""} />}
            </div>
          )}
          <LibraryScopeChips value={scope} onChange={changeScope} />
          {canEdit && !sel.selecting && !!words.data?.length && (
            <Button type="button" variant="ghost" className="self-end" onClick={sel.start}>
              <ListChecks aria-hidden />
              {t("albums.select.start")}
            </Button>
          )}
          {words.isPending && <p className="text-muted-foreground">{t("common.loading")}</p>}
          {words.isError && <p className="text-destructive">{t("common.loadError")}</p>}
          {words.data?.length === 0 && scope !== "all" && <ScopeEmptyState scope={scope} onViewAll={() => changeScope("all")} />}
          {words.data?.length === 0 && scope === "all" && <p className="text-muted-foreground">{t("words.empty")}</p>}
          {!!words.data?.length && (
            <WordList words={words.data} glossLang={profile.gloss_lang} selecting={canEdit && sel.selecting} selected={sel.selected} onToggle={sel.toggle} />
          )}
          {canEdit && sel.selecting && (
            <SelectionBar count={sel.ids.length} total={words.data?.length ?? 0} onSelectAll={sel.selectAll} onDone={sel.stop}>
              <Button type="button" disabled={sel.ids.length === 0} onClick={() => setAdding(true)}>
                {t("albums.select.addToAlbum")}
              </Button>
              {!unsorted && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={sel.ids.length === 0 || remove.isPending}
                  onClick={() => remove.mutate({ profileId: profile.id, albumId: id, wordIds: sel.ids }, { onSuccess: sel.stop })}
                >
                  {t("albums.select.removeFromAlbum")}
                </Button>
              )}
            </SelectionBar>
          )}
          <AddToAlbumDialog open={adding} onOpenChange={setAdding} profileId={profile.id} lang={lang} wordIds={sel.ids} onDone={sel.stop} />
        </>
      )}
    </PageShell>
  );
}
