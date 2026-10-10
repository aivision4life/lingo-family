import { CircleCheck, Headphones, Image, Type } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { NativeSelect } from "@/components/NativeSelect";
import { useReviewSummary } from "./api";

const TYPE_ICONS = { recognition: Type, picture: Image, listening: Headphones } as const;
/** `<select>` value for "all words" (no album filter). */
const ALL = "";

type Row = NonNullable<ReturnType<typeof useReviewSummary>["data"]>[number];

/** One row per learning language: due/new counts, an album chooser (when there are albums) and "Start review". */
export function LangSummaryList({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  const summary = useReviewSummary(profileId);

  if (summary.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (summary.isError) return <p className="text-destructive">{t("common.loadError")}</p>;
  if (summary.data.length === 0) return <p className="text-muted-foreground">{t("review.noLangs")}</p>;

  return (
    <ul className="flex flex-col gap-3">
      {summary.data.map((row) => (
        <LangRow key={row.lang} row={row} />
      ))}
    </ul>
  );
}

function LangRow({ row }: { row: Row }) {
  const { t } = useTranslation();
  const { lang, by_type, albums } = row;
  const [album, setAlbum] = useState(ALL);
  // The chosen album may disappear (deleted, emptied): fall back to "all".
  const chosen = albums.find((a) => a.id === album);
  const due = chosen ? chosen.due : row.due;
  const fresh = chosen ? chosen.new : row.new;
  const link = `/review?lang=${lang}${chosen ? `&album=${chosen.id}` : ""}`;
  const selectId = `album-${lang}`;

  return (
    <li className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-lg font-semibold">{t(`langs.${lang}`)}</span>
          <span className="text-sm text-muted-foreground">{t("review.counts", { due, new: fresh })}</span>
          {/* Card types describe the whole language; with an album chosen only the counts above apply. */}
          {!chosen && (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={t("review.byType")}>
              {(Object.keys(TYPE_ICONS) as (keyof typeof TYPE_ICONS)[]).map((type) => {
                const Icon = TYPE_ICONS[type];
                return (
                  <li key={type} className="flex items-center gap-1 text-muted-foreground">
                    <Icon aria-hidden className="size-4" />
                    {t(`review.typeShort.${type}`)} <b className="text-foreground">{by_type[type]}</b>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {due + fresh > 0 ? (
          <LinkButton to={link}>{t("review.start")}</LinkButton>
        ) : (
          <CircleCheck className="size-6 text-green-600" aria-label={t("review.nothingToday")} />
        )}
      </div>
      {albums.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor={selectId} className="text-sm text-muted-foreground">
            {t("albums.review.label")}
          </label>
          <NativeSelect id={selectId} value={chosen ? chosen.id : ALL} onChange={(e) => setAlbum(e.target.value)}>
            <option value={ALL}>{t("albums.review.all")}</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {t("albums.review.option", { name: a.name, count: a.due + a.new })}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </li>
  );
}
