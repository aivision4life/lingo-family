import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { z } from "zod";
import { skippedPhraseSchema } from "@shared/phrase";
import type { WordDetail } from "@shared/word";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { PhraseAdder } from "./PhraseAdder";
import { PhraseItem } from "./PhraseItem";
import { SkippedNotice } from "./SkippedNotice";

/** Set by the Add word screen: ticked phrases that already existed and were not saved. */
const navStateSchema = z.object({ skippedPhrases: z.array(skippedPhraseSchema) });

/** "Phrases" on Word detail: list (listen; adults edit/delete) + suggest / add by hand. */
export function PhrasesSection({ word }: { word: WordDetail }) {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const location = useLocation();
  const adultId = profile && canManageProfiles(profile) ? profile.id : null;
  const nav = navStateSchema.safeParse(location.state);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("phrases.title")}</h2>
      {nav.success && <SkippedNotice skipped={nav.data.skippedPhrases} />}
      {word.phrases.length === 0 && <p className="text-muted-foreground">{t("phrases.none")}</p>}
      <ul className="flex flex-col gap-3">
        {word.phrases.map((p) => (
          <PhraseItem key={p.id} phrase={p} glossLang={profile?.gloss_lang ?? "vi"} editorId={adultId} />
        ))}
      </ul>
      {adultId && <PhraseAdder wordId={word.id} lang={word.lang} profileId={adultId} level="beginner" />}
    </section>
  );
}
