import { Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { UNSORTED_ALBUM, type AlbumList } from "@shared/album";
import type { LearnLang } from "@shared/enums";
import { AlbumCover } from "./AlbumCover";

const CARD = "flex min-w-0 flex-col gap-2 rounded-xl border p-2 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50";

type Props = { data: AlbumList; lang: LearnLang | null };

/**
 * Album cards (cover, name, number of words), two per row on phones. The virtual "Unsorted"
 * entries come first: words that are in no album, one per language, only when there are any.
 */
export function AlbumGrid({ data, lang }: Props) {
  const { t } = useTranslation();
  const unsorted = data.unsorted.filter((u) => u.word_count > 0 && (!lang || u.lang === lang));
  const albums = data.albums.filter((a) => !lang || a.lang === lang);

  if (unsorted.length === 0 && albums.length === 0) return <p className="text-muted-foreground">{t("albums.empty")}</p>;
  return (
    <ul className="grid grid-cols-2 gap-3">
      {unsorted.map((u) => (
        <li key={`unsorted-${u.lang}`}>
          <Link to={`/albums/${UNSORTED_ALBUM}?lang=${u.lang}`} className={CARD}>
            <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-dashed bg-background">
              <Inbox aria-hidden className="size-1/3 text-muted-foreground" />
            </div>
            <span className="truncate font-semibold">{t("albums.unsorted")}</span>
            <span className="truncate text-sm text-muted-foreground">
              {t(`langs.${u.lang}`)} · {t("albums.wordCount", { count: u.word_count })}
            </span>
          </Link>
        </li>
      ))}
      {albums.map((a) => (
        <li key={a.id}>
          <Link to={`/albums/${a.id}`} className={CARD}>
            <AlbumCover cover={a.cover} name={a.name} />
            <span className="truncate font-semibold">{a.name}</span>
            <span className="truncate text-sm text-muted-foreground">
              {t(`langs.${a.lang}`)} · {t("albums.wordCount", { count: a.word_count })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
