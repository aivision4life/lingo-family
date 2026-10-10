import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { showAddWordButton } from "@/components/layout/addWordVisibility";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { AlbumsTab } from "@/features/albums/AlbumsTab";
import { LibraryTabs, type LibraryView } from "@/features/albums/LibraryTabs";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { AllWordsView } from "@/features/words/AllWordsView";

/**
 * Screen 4 — shared family library. Tabs: "All" (words / phrases, search, language filter) and
 * "Albums" (playlists of words, M2.4). The tab is kept in the URL (?view=albums) so "back" from an
 * album returns to the Albums tab.
 */
export function WordLibraryPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [params, setParams] = useSearchParams();
  const view: LibraryView = params.get("view") === "albums" ? "albums" : "all";
  const canEdit = showAddWordButton(profile);

  if (!profile) return null;
  return (
    <PageShell title={t("pages.words.title")}>
      {/* On every screen size (the phone's floating "+" is a second way in). */}
      {canEdit && (
        <LinkButton to="/words/new" size="lg">
          <Plus aria-hidden />
          {t("pages.words.addWord")}
        </LinkButton>
      )}
      <LibraryTabs value={view} onChange={(v) => setParams(v === "albums" ? { view: "albums" } : {}, { replace: true })} />
      {view === "all" ? (
        <AllWordsView glossLang={profile.gloss_lang} profileId={profile.id} canEdit={canEdit} />
      ) : (
        <AlbumsTab profileId={profile.id} canEdit={canEdit} defaultLang={profile.study_langs[0] ?? "ko"} />
      )}
    </PageShell>
  );
}
