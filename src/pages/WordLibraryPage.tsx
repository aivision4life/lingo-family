import { Plus, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
import { showAddWordButton } from "@/components/layout/addWordVisibility";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { Input } from "@/components/ui/input";
import { usePhrases } from "@/features/phrases/api";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useWords } from "@/features/words/api";
import { LangChips } from "@/features/words/bits";
import { PhraseRow, WordRow } from "@/features/words/LibraryRows";
import { cn } from "@/lib/utils";

type Kind = "words" | "phrases";

/** Screen 4 — shared family library: words or phrases, search and language filter (F2). */
export function WordLibraryPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [kind, setKind] = useState<Kind>("words");
  const [lang, setLang] = useState<LearnLang | null>(null);
  const [query, setQuery] = useState("");
  // Typing stays responsive; the search request follows slightly behind.
  const q = useDeferredValue(query.trim());
  const filter = { lang: lang ?? undefined, q: q || undefined };
  const words = useWords(filter);
  const phrases = usePhrases(filter, kind === "phrases");
  const list = kind === "words" ? words : phrases;
  const glossLang = profile?.gloss_lang ?? "vi";

  return (
    <PageShell title={t("pages.words.title")}>
      {/* On every screen size (the phone's floating "+" is a second way in). */}
      {showAddWordButton(profile) && (
        <LinkButton to="/words/new" size="lg">
          <Plus aria-hidden />
          {t("pages.words.addWord")}
        </LinkButton>
      )}

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
            onClick={() => setKind(k)}
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

      {list.isPending && <p className="text-muted-foreground">{t("common.loading")}</p>}
      {list.isError && <p className="text-destructive">{t("common.loadError")}</p>}
      {list.data?.length === 0 && (
        <p className="text-muted-foreground">
          {q || lang ? t("words.noResults") : kind === "words" ? t("words.empty") : t("phrases.none")}
        </p>
      )}

      {kind === "words" && !!words.data?.length && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {words.data.map((w) => (
            <WordRow key={w.id} w={w} glossLang={glossLang} />
          ))}
        </ul>
      )}
      {kind === "phrases" && !!phrases.data?.length && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {phrases.data.map((p) => (
            <PhraseRow key={p.id} p={p} glossLang={glossLang} />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
