import { ListChecks, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { LearnLang, UiLang } from "@shared/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddToAlbumDialog } from "@/features/albums/AddToAlbumDialog";
import { SelectionBar } from "@/features/albums/SelectionBar";
import { useWordSelection } from "@/features/albums/useWordSelection";
import { WordList } from "@/features/albums/WordList";
import { FocusLayer } from "@/features/focus/FocusLayer";
import { focusKey, itemsFromWord, parseFocusKey } from "@/features/focus/focusItems";
import { useFocusRoute } from "@/features/focus/useFocusRoute";
import { usePhrases } from "@/features/phrases/api";
import { cn } from "@/lib/utils";
import { useWord, useWords } from "./api";
import { LangChips } from "./bits";
import { PhraseRow } from "./LibraryRows";

type Kind = "words" | "phrases";

type Props = { glossLang: UiLang; profileId: string; canEdit: boolean };

/** Library → "All": words or phrases, search, language filter; adults can select many words (albums). */
export function AllWordsView({ glossLang, profileId, canEdit }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>("words");
  const [lang, setLang] = useState<LearnLang | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  // Typing stays responsive; the search request follows slightly behind.
  const q = useDeferredValue(query.trim());
  const filter = { lang: lang ?? undefined, q: q || undefined };
  const words = useWords(filter);
  const phrases = usePhrases(filter, kind === "phrases");
  const list = kind === "words" ? words : phrases;
  const sel = useWordSelection(words.data ?? []);

  // Enlarging a phrase from the list (M2.5): the view shows the phrase and its root word's other
  // sentences / phrases, loaded when it opens (the list has only the phrase itself).
  const [params] = useSearchParams();
  const wantedFocus = parseFocusKey(params.get("focus"));
  const focusedPhrase = wantedFocus?.kind === "phrase" ? phrases.data?.find((p) => p.id === wantedFocus.id) : undefined;
  const focusWord = useWord(focusedPhrase?.word_id ?? "", { enabled: !!focusedPhrase });
  const focusItems = focusedPhrase && focusWord.data ? itemsFromWord(focusWord.data) : [];
  const focusRoute = useFocusRoute(focusItems);
  // Phrases follow their root word into albums, so selection only exists on the Words tab.
  const selecting = canEdit && kind === "words" && sel.selecting;

  return (
    <FocusLayer items={focusItems} route={focusRoute} glossLang={glossLang}>
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("words.searchPlaceholder")}
          aria-label={t("words.searchPlaceholder")}
          className="pl-10"
        />
      </div>
      <div role="group" aria-label={t("words.kindLabel")} className="flex gap-2">
        {(["words", "phrases"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              sel.stop();
            }}
            className={cn(
              "min-h-11 flex-1 rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              kind === k ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
            )}
          >
            {k === "words" ? t("words.kindWords") : t("words.kindPhrases")}
          </button>
        ))}
      </div>
      <LangChips allowAll label={t("words.add.lang")} value={lang} onChange={setLang} />
      {canEdit && kind === "words" && !selecting && !!words.data?.length && (
        <Button type="button" variant="ghost" className="self-end" onClick={sel.start}>
          <ListChecks aria-hidden />
          {t("albums.select.start")}
        </Button>
      )}

      {list.isPending && <p className="text-muted-foreground">{t("common.loading")}</p>}
      {list.isError && <p className="text-destructive">{t("common.loadError")}</p>}
      {list.data?.length === 0 && (
        <p className="text-muted-foreground">
          {q || lang ? t("words.noResults") : kind === "words" ? t("words.empty") : t("phrases.none")}
        </p>
      )}

      {kind === "words" && !!words.data?.length && (
        <WordList words={words.data} glossLang={glossLang} selecting={selecting} selected={sel.selected} onToggle={sel.toggle} />
      )}
      {kind === "phrases" && !!phrases.data?.length && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {phrases.data.map((p) => (
            <PhraseRow key={p.id} p={p} glossLang={glossLang} onExpand={() => focusRoute.open(focusKey("phrase", p.id))} />
          ))}
        </ul>
      )}

      {selecting && (
        <SelectionBar
          count={sel.ids.length}
          total={words.data?.length ?? 0}
          onSelectAll={sel.selectAll}
          onDone={sel.stop}
          notice={sel.ids.length > 0 && !sel.lang ? t("albums.select.mixedLang") : null}
        >
          <Button type="button" disabled={!sel.lang} onClick={() => setAdding(true)}>
            {t("albums.select.addToAlbum")}
          </Button>
        </SelectionBar>
      )}
      {sel.lang && (
        <AddToAlbumDialog open={adding} onOpenChange={setAdding} profileId={profileId} lang={sel.lang} wordIds={sel.ids} onDone={sel.stop} />
      )}
    </FocusLayer>
  );
}
