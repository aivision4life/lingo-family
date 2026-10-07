import { Plus, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { LearnLang } from "@shared/enums";
import { LangText } from "@/components/LangText";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { Input } from "@/components/ui/input";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { useWords } from "@/features/words/api";
import { AiBadge, LangChips } from "@/features/words/bits";
import { glossFor } from "@/features/words/format";

/** Screen 4 — shared family word library with search and language filter (F2). */
export function WordLibraryPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [lang, setLang] = useState<LearnLang | null>(null);
  const [query, setQuery] = useState("");
  // Typing stays responsive; the search request follows slightly behind.
  const q = useDeferredValue(query.trim());
  const words = useWords({ lang: lang ?? undefined, q: q || undefined });
  const glossLang = profile?.gloss_lang ?? "vi";

  return (
    <PageShell title={t("pages.words.title")}>
      {canManageProfiles(profile) && (
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
      <LangChips allowAll label={t("words.add.lang")} value={lang} onChange={setLang} />

      {words.isPending && <p className="text-muted-foreground">{t("common.loading")}</p>}
      {words.isError && <p className="text-destructive">{t("common.loadError")}</p>}
      {words.data?.length === 0 && (
        <p className="text-muted-foreground">{q || lang ? t("words.noResults") : t("words.empty")}</p>
      )}

      {!!words.data?.length && (
      <ul className="flex flex-col divide-y rounded-lg border">
        {words.data.map((w) => (
          <li key={w.id}>
            <Link to={`/words/${w.id}`} className="flex min-h-16 items-center gap-3 px-3 py-2 hover:bg-accent">
              <span className="w-10 text-center text-3xl" aria-hidden>
                {w.emoji}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline gap-2">
                  <LangText lang={w.lang} className="truncate text-xl font-semibold">
                    {w.term}
                  </LangText>
                  <span className="truncate text-sm text-muted-foreground">{w.reading}</span>
                </span>
                <span lang={glossLang} className="truncate text-sm">
                  {glossFor(w, glossLang)}
                </span>
              </span>
              {w.ai_generated && !w.verified && <AiBadge />}
            </Link>
          </li>
        ))}
      </ul>
      )}
    </PageShell>
  );
}
