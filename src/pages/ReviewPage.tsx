import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { learnLangSchema, type LearnLang } from "@shared/enums";
import { LinkButton } from "@/components/LinkButton";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useAlbums } from "@/features/albums/api";
import { useReviewQueue } from "@/features/review/api";
import { DevClockPanel } from "@/features/review/DevClockPanel";
import { LangSummaryList } from "@/features/review/LangSummaryList";
import { ReviewSession } from "@/features/review/ReviewSession";

/** Screen 3 — review session for one language (`/review?lang=ko`), or a language chooser. */
export function ReviewPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [params] = useSearchParams();
  const lang = learnLangSchema.safeParse(params.get("lang"));
  // ?album=<id>: review only that album (the schedule and the daily limit stay per language).
  const albumId = params.get("album") ?? undefined;
  const albums = useAlbums(lang.success ? lang.data : null);
  const albumName = albumId ? albums.data?.albums.find((a) => a.id === albumId)?.name : undefined;
  if (!profile) return null;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-bold">{lang.success ? t(`langs.${lang.data}`) : t("review.chooseLang")}</h1>
          {albumName && <span className="truncate text-sm text-muted-foreground">{t("albums.review.inAlbum", { name: albumName })}</span>}
        </div>
        <LinkButton to="/home" variant="outline">
          <X aria-hidden />
          {t("review.exit")}
        </LinkButton>
      </div>
      <DevClockPanel />
      {lang.success ? (
        <Session profileId={profile.id} lang={lang.data} album={albumId} glossLang={profile.gloss_lang} />
      ) : (
        <LangSummaryList profileId={profile.id} />
      )}
    </section>
  );
}

function Session({ profileId, lang, album, glossLang }: { profileId: string; lang: LearnLang; album?: string; glossLang: "vi" | "ko" | "en" }) {
  const { t } = useTranslation();
  const queue = useReviewQueue(profileId, lang, album);

  if (queue.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (queue.isError) return <p className="text-destructive">{t("common.loadError")}</p>;
  if (queue.data.items.length === 0) return <p className="py-10 text-center text-lg">{t("review.nothingToday")}</p>;
  // Keyed by the loaded data so a new queue (e.g. after changing the dev date) starts a new session.
  return <ReviewSession key={queue.dataUpdatedAt} profileId={profileId} glossLang={glossLang} items={queue.data.items} />;
}
