import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { TopikVocabEntry } from "@shared/topik";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { useWordLookup } from "@/features/words/api";

/** One tappable word inside a TOPIK question's text (M6.2): bấm từ → popup with its meaning. */
export function TopikWordTap({ entry }: { entry: TopikVocabEntry }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          lang="ko"
          // Stops a tap from also selecting the practice-screen option this word sits inside (the
          // option itself is a role="button" container, not a <button>, precisely to allow this).
          onClick={(e) => e.stopPropagation()}
          className="rounded-sm underline decoration-dotted decoration-from-font underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {entry.surface}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <WordMeaning entry={entry} />
      </PopoverContent>
    </Popover>
  );
}

function WordMeaning({ entry }: { entry: TopikVocabEntry }) {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const lookup = useWordLookup("ko", entry.lemma);

  const gloss = lookup.data ? lookup.data.gloss_vi : entry.gloss_vi;
  const addHref = `/words/new?lang=ko&term=${encodeURIComponent(entry.lemma)}&autofill=1`;

  return (
    <div className="flex flex-col gap-1.5">
      <p lang="ko" className="text-lg font-semibold">
        {entry.lemma}
      </p>
      {lookup.isPending ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : lookup.isError ? (
        <p className="text-sm text-destructive">{t("topik.practice.word.loadError")}</p>
      ) : (
        <p className="text-sm">{gloss}</p>
      )}
      {lookup.data ? (
        <Link to={`/words/${lookup.data.id}`} className="text-sm font-medium text-primary underline underline-offset-4">
          {t("topik.practice.word.alreadyInLibrary")}
        </Link>
      ) : (
        canManageProfiles(profile) && (
          <Link to={addHref} className="text-sm font-medium text-primary underline underline-offset-4">
            {t("topik.practice.word.addToLibrary")}
          </Link>
        )
      )}
    </div>
  );
}
